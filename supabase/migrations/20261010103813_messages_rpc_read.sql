create function public.dm_conversations(
  p_before timestamptz default null, p_before_id bigint default null, p_limit int default 30
)
returns table (
  id bigint, other jsonb, last_message_at timestamptz, last_body text,
  last_sender_is_me boolean, unread int, can_send boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  return query
  select c.id,
    case when them.user_id is not null then public.forum_author_json(them.user_id) end,
    c.last_message_at,
    case when latest.deleted_at is null then left(latest.body, 160) end,
    coalesce(latest.sender_id = v_user, false),
    (select count(*)::int from public.dm_messages msg
      where msg.conversation_id = c.id and msg.id > me.last_read_id
        and msg.sender_id is distinct from v_user and msg.deleted_at is null),
    coalesce(public.dm_allowed(v_user, them.user_id), false)
  from public.dm_members me
  join public.dm_conversations c on c.id = me.conversation_id
  left join public.dm_members them
    on them.conversation_id = c.id and them.user_id <> v_user
  join lateral (
    select msg.sender_id, msg.body, msg.deleted_at
    from public.dm_messages msg where msg.conversation_id = c.id
    order by msg.id desc limit 1
  ) latest on true
  where me.user_id = v_user
    and (p_before is null
      or (p_before_id is null and c.last_message_at < p_before)
      or (p_before_id is not null and (c.last_message_at, c.id) < (p_before, p_before_id)))
  order by c.last_message_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
end;
$$;

create function public.dm_messages(
  p_conversation bigint, p_before_id bigint default null, p_limit int default 50
)
returns table (id bigint, sender_id uuid, body text, created_at timestamptz, deleted boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  if not exists (
    select 1 from public.dm_members m
    where m.conversation_id = p_conversation and m.user_id = v_user
  ) then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  return query
  select msg.id, msg.sender_id,
    case when msg.deleted_at is null then msg.body end,
    msg.created_at, msg.deleted_at is not null
  from public.dm_messages msg
  where msg.conversation_id = p_conversation
    and (p_before_id is null or msg.id < p_before_id)
  order by msg.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

create function public.dm_mark_read(p_conversation bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_last bigint;
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  if not exists (
    select 1 from public.dm_members m
    where m.conversation_id = p_conversation and m.user_id = v_user
  ) then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  select m.user_id into v_other from public.dm_members m
  where m.conversation_id = p_conversation and m.user_id <> v_user;
  if v_other is not null then
    perform public.social_lock_pair(v_user, v_other);
  end if;
  update public.dm_members m
  set last_read_id = greatest(m.last_read_id, coalesce((
    select max(msg.id) from public.dm_messages msg
    where msg.conversation_id = p_conversation
  ), 0))
  where m.conversation_id = p_conversation and m.user_id = v_user
  returning m.last_read_id into v_last;
  update public.notifications n set read_at = now()
  where n.recipient_id = v_user and n.actor_id = v_other
    and n.kind = 'message' and n.read_at is null;
  return v_last;
end;
$$;

create function public.dm_delete_message(p_message bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  update public.dm_messages msg set deleted_at = now(), body = ''
  where msg.id = p_message and msg.sender_id = v_user and msg.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  return true;
end;
$$;

create function public.dm_unread_count()
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  return (
    select count(*)::int from public.dm_members me
    where me.user_id = v_user and exists (
      select 1 from public.dm_messages msg
      where msg.conversation_id = me.conversation_id and msg.id > me.last_read_id
        and msg.sender_id is distinct from v_user and msg.deleted_at is null
    )
  );
end;
$$;

create function public.dm_can_message(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  return p_user is distinct from v_user
    and coalesce(public.dm_allowed(v_user, p_user), false);
end;
$$;

create or replace function public.notify(
  p_recipient uuid, p_actor uuid, p_kind text,
  p_thread bigint default null, p_post bigint default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then
    return;
  end if;
  if not coalesce((
    select (p.notify->>p_kind)::boolean
    from public.profiles p where p.id = p_recipient
  ), true) then
    return;
  end if;
  if exists (
    select 1 from public.social_blocks b
    where (b.blocker_id = p_recipient and b.blocked_id = p_actor)
      or (b.blocker_id = p_actor and b.blocked_id = p_recipient)
  ) then
    return;
  end if;
  if p_kind in ('follow', 'friend_request') then
    delete from public.notifications n
    where n.recipient_id = p_recipient and n.actor_id = p_actor
      and n.kind = p_kind and n.read_at is null;
  elsif p_kind = 'message' and exists (
    select 1 from public.notifications n
    where n.recipient_id = p_recipient and n.actor_id = p_actor
      and n.kind = 'message' and n.read_at is null
  ) then
    return;
  end if;
  insert into public.notifications (recipient_id, actor_id, kind, thread_id, post_id)
  values (p_recipient, p_actor, p_kind, p_thread, p_post);
  delete from public.notifications n
  where n.recipient_id = p_recipient and n.read_at is not null
    and n.created_at < now() - interval '90 days';
end;
$$;

create function public.dm_message_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify((
    select m.user_id from public.dm_members m
    where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id
  ), new.sender_id, 'message', null, null);
  return new;
end;
$$;

create trigger dm_message_notification
after insert on public.dm_messages
for each row execute function public.dm_message_notification();

revoke all on function public.dm_conversations(timestamptz, bigint, int) from public, anon, authenticated;
revoke all on function public.dm_messages(bigint, bigint, int) from public, anon, authenticated;
revoke all on function public.dm_mark_read(bigint) from public, anon, authenticated;
revoke all on function public.dm_delete_message(bigint) from public, anon, authenticated;
revoke all on function public.dm_unread_count() from public, anon, authenticated;
revoke all on function public.dm_can_message(uuid) from public, anon, authenticated;
revoke all on function public.dm_message_notification() from public, anon, authenticated;

grant execute on function public.dm_conversations(timestamptz, bigint, int) to authenticated;
grant execute on function public.dm_messages(bigint, bigint, int) to authenticated;
grant execute on function public.dm_mark_read(bigint) to authenticated;
grant execute on function public.dm_delete_message(bigint) to authenticated;
grant execute on function public.dm_unread_count() to authenticated;
grant execute on function public.dm_can_message(uuid) to authenticated;

create or replace function public.dm_reply_allowed(p_conversation bigint, p_actor uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.dm_allowed(p_actor, p_target) or (
    exists (
      select 1 from public.dm_messages msg
      where msg.conversation_id = p_conversation and msg.sender_id = p_target
    )
    and not exists (
      select 1 from public.social_blocks b
      where (b.blocker_id = p_actor and b.blocked_id = p_target)
        or (b.blocker_id = p_target and b.blocked_id = p_actor)
    )
  );
$$;

revoke all on function public.dm_reply_allowed(bigint, uuid, uuid) from public, anon, authenticated;

create or replace function public.dm_conversations(
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
    coalesce(public.dm_reply_allowed(c.id, v_user, them.user_id), false)
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

revoke all on function public.dm_conversations(timestamptz, bigint, int) from public, anon, authenticated;
grant execute on function public.dm_conversations(timestamptz, bigint, int) to authenticated;

create or replace function public.dm_conversation(p_conversation bigint)
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
  if not exists (
    select 1 from public.dm_members m
    where m.conversation_id = p_conversation and m.user_id = v_user
  ) then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
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
    coalesce(public.dm_reply_allowed(c.id, v_user, them.user_id), false)
  from public.dm_members me
  join public.dm_conversations c on c.id = me.conversation_id
  left join public.dm_members them
    on them.conversation_id = c.id and them.user_id <> v_user
  left join lateral (
    select msg.sender_id, msg.body, msg.deleted_at
    from public.dm_messages msg where msg.conversation_id = c.id
    order by msg.id desc limit 1
  ) latest on true
  where me.user_id = v_user
    and c.id = p_conversation;
end;
$$;

revoke all on function public.dm_conversation(bigint) from public, anon, authenticated;
grant execute on function public.dm_conversation(bigint) to authenticated;

create or replace function public.dm_moderate_delete(p_message bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'dm:forbidden';
  end if;
  perform 1 from public.dm_messages msg where msg.id = p_message for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  perform 1 from public.dm_reports r
  where r.message_id = p_message and r.status = 'open'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  update public.dm_messages msg
  set deleted_at = now(), body = ''
  where msg.id = p_message and msg.deleted_at is null;
  update public.dm_reports r
  set status = 'resolved', resolved_by = v_user, resolved_at = now()
  where r.message_id = p_message and r.status = 'open';
end;
$$;

revoke all on function public.dm_moderate_delete(bigint) from public, anon, authenticated;
grant execute on function public.dm_moderate_delete(bigint) to authenticated;

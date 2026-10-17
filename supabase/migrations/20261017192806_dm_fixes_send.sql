create or replace function public.dm_send(p_conversation bigint, p_body text)
returns table (id bigint, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_other uuid;
  v_body text := btrim(p_body);
  v_id bigint;
  v_now timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  v_user := public.social_write_user();
  if exists (
    select 1 from public.forum_bans b
    where b.user_id = v_user and (b.until is null or b.until > now())
  ) then
    raise exception using errcode = 'P0001', message = 'dm:banned';
  end if;
  if not exists (
    select 1 from public.dm_members m
    where m.conversation_id = p_conversation and m.user_id = v_user
  ) then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 2000 then
    raise exception using errcode = 'P0001', message = 'dm:invalid';
  end if;
  select m.user_id into v_other from public.dm_members m
  where m.conversation_id = p_conversation and m.user_id <> v_user;
  if v_other is null then
    raise exception using errcode = 'P0001', message = 'dm:unavailable';
  end if;
  perform public.social_lock_pair(v_user, v_other);
  if not public.dm_reply_allowed(p_conversation, v_user, v_other) then
    raise exception using errcode = 'P0001', message = 'dm:unavailable';
  end if;
  perform public.social_rate_limit(v_user, 'dm_message');
  select greatest(clock_timestamp(), coalesce(c.last_message_at, '-infinity'::timestamptz))
  into v_now from public.dm_conversations c where c.id = p_conversation;
  insert into public.dm_messages (conversation_id, sender_id, body, created_at)
  values (p_conversation, v_user, v_body, v_now)
  returning dm_messages.id into v_id;
  update public.dm_conversations c set last_message_at = v_now
  where c.id = p_conversation;
  update public.dm_members m set last_read_id = v_id
  where m.conversation_id = p_conversation and m.user_id = v_user;
  return query select v_id, v_now;
end;
$$;

revoke all on function public.dm_send(bigint, text) from public, anon, authenticated;
grant execute on function public.dm_send(bigint, text) to authenticated;

drop function public.dm_mark_read(bigint);

create or replace function public.dm_mark_read(p_conversation bigint, p_up_to bigint default null)
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
      and (p_up_to is null or msg.id <= p_up_to)
  ), 0))
  where m.conversation_id = p_conversation and m.user_id = v_user
  returning m.last_read_id into v_last;
  update public.notifications n set read_at = now()
  where n.recipient_id = v_user and n.actor_id = v_other
    and n.kind = 'message' and n.read_at is null
    and not exists (
      select 1 from public.dm_messages msg
      where msg.conversation_id = p_conversation and msg.id > v_last
        and msg.sender_id = v_other
    );
  return v_last;
end;
$$;

revoke all on function public.dm_mark_read(bigint, bigint) from public, anon, authenticated;
grant execute on function public.dm_mark_read(bigint, bigint) to authenticated;

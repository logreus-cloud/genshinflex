create function public.dm_conversation(p_conversation bigint)
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
    coalesce(public.dm_allowed(v_user, them.user_id), false)
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

create function public.dm_resolve_report(p_report bigint, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_message bigint;
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'dm:forbidden';
  end if;
  if p_status is null or p_status not in ('resolved', 'dismissed') then
    raise exception using errcode = 'P0001', message = 'dm:invalid';
  end if;
  select r.message_id into v_message from public.dm_reports r where r.id = p_report;
  if not found then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  update public.dm_reports r
  set status = p_status, resolved_by = v_user, resolved_at = now()
  where r.message_id = v_message and (r.status = 'open' or r.id = p_report);
end;
$$;

create function public.dm_moderate_delete(p_message bigint)
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
  update public.dm_messages msg
  set deleted_at = now(), body = ''
  where msg.id = p_message and msg.deleted_at is null;
  update public.dm_reports r
  set status = 'resolved', resolved_by = v_user, resolved_at = now()
  where r.message_id = p_message and r.status = 'open';
end;
$$;

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
  if not public.dm_allowed(v_user, v_other) then
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

revoke all on function public.dm_resolve_report(bigint, text) from public, anon, authenticated;
revoke all on function public.dm_moderate_delete(bigint) from public, anon, authenticated;
revoke all on function public.dm_send(bigint, text) from public, anon, authenticated;
grant execute on function public.dm_resolve_report(bigint, text) to authenticated;
grant execute on function public.dm_moderate_delete(bigint) to authenticated;
grant execute on function public.dm_send(bigint, text) to authenticated;

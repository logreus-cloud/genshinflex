create function public.set_message_privacy(p_value text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_privacy jsonb;
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  if p_value is null or p_value not in ('everyone', 'followers', 'friends') then
    raise exception using errcode = 'P0001', message = 'dm:invalid';
  end if;
  update public.profiles p
  set privacy = p.privacy || pg_catalog.jsonb_build_object('messages', p_value)
  where p.id = v_user
  returning p.privacy into v_privacy;
  return v_privacy;
end;
$$;

create or replace function public.social_rate_limit(p_actor uuid, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit int;
begin
  if p_kind = 'follow' then
    v_limit := 60;
  elsif p_kind = 'friend_request' then
    v_limit := 20;
  elsif p_kind = 'dm_open' then
    v_limit := 20;
  elsif p_kind = 'dm_message' then
    v_limit := 300;
  else
    raise exception using errcode = 'P0001', message = 'social:invalid';
  end if;
  delete from public.social_rate_events e
  where e.user_id = p_actor and e.created_at <= now() - interval '1 day';
  if (select count(*) from public.social_rate_events e
    where e.user_id = p_actor and e.kind = p_kind
      and e.created_at > now() - interval '1 hour') >= v_limit then
    raise exception using errcode = 'P0001', message = 'social:rate_limited';
  end if;
  insert into public.social_rate_events (user_id, kind) values (p_actor, p_kind);
end;
$$;

create function public.dm_allowed(p_actor uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_target and p.is_public
      and not exists (
        select 1 from public.social_blocks b
        where (b.blocker_id = p_actor and b.blocked_id = p_target)
          or (b.blocker_id = p_target and b.blocked_id = p_actor)
      )
      and (
        coalesce(p.privacy->>'messages', 'everyone') = 'everyone'
        or (p.privacy->>'messages' = 'followers' and exists (
          select 1 from public.social_follows f
          where f.follower_id = p_actor and f.followee_id = p_target
        ))
        or (p.privacy->>'messages' = 'friends' and exists (
          select 1 from public.social_friendships f
          where f.status = 'accepted'
            and ((f.requester_id = p_actor and f.addressee_id = p_target)
              or (f.requester_id = p_target and f.addressee_id = p_actor))
        ))
        or exists (
          select 1 from public.dm_conversations c
          join public.dm_messages msg on msg.conversation_id = c.id
          where c.pair_key = least(p_actor, p_target)::text || ':' || greatest(p_actor, p_target)::text
            and msg.sender_id = p_target
        )
      )
  );
$$;

create function public.dm_open(p_user uuid)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_pair text;
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  v_user := public.social_write_user();
  if p_user = v_user then
    raise exception using errcode = 'P0001', message = 'dm:self';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.is_public) then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  perform public.social_lock_pair(v_user, p_user);
  if exists (
    select 1 from public.social_blocks b
    where (b.blocker_id = v_user and b.blocked_id = p_user)
      or (b.blocker_id = p_user and b.blocked_id = v_user)
  ) then
    raise exception using errcode = 'P0001', message = 'dm:unavailable';
  end if;
  v_pair := least(v_user, p_user)::text || ':' || greatest(v_user, p_user)::text;
  select c.id into v_id from public.dm_conversations c where c.pair_key = v_pair;
  if found then return v_id; end if;
  if not public.dm_allowed(v_user, p_user) then
    raise exception using errcode = 'P0001', message = 'dm:unavailable';
  end if;
  perform public.social_rate_limit(v_user, 'dm_open');
  insert into public.dm_conversations (pair_key) values (v_pair) returning id into v_id;
  insert into public.dm_members (conversation_id, user_id)
  values (v_id, v_user), (v_id, p_user);
  return v_id;
end;
$$;

create function public.dm_send(p_conversation bigint, p_body text)
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

revoke all on function public.set_message_privacy(text) from public, anon, authenticated;
revoke all on function public.social_rate_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.dm_allowed(uuid, uuid) from public, anon, authenticated;
revoke all on function public.dm_open(uuid) from public, anon, authenticated;
revoke all on function public.dm_send(bigint, text) from public, anon, authenticated;
grant execute on function public.set_message_privacy(text) to authenticated;
grant execute on function public.dm_open(uuid) to authenticated;
grant execute on function public.dm_send(bigint, text) to authenticated;

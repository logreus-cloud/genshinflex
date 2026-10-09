alter table public.profiles drop constraint if exists profiles_privacy_shape;
alter table public.profiles add constraint profiles_privacy_shape check (
  jsonb_typeof(privacy) = 'object'
  and privacy - array['uid', 'roster', 'favorites', 'wishes', 'connections', 'requests'] = '{}'::jsonb
  and coalesce(jsonb_typeof(privacy->'uid'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(privacy->'roster'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(privacy->'favorites'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(privacy->'wishes'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(privacy->'connections'), 'boolean') = 'boolean'
  and (not privacy ? 'requests' or (
    jsonb_typeof(privacy->'requests') = 'string'
    and privacy->>'requests' in ('everyone', 'followed', 'nobody')
  ))
);

create or replace function public.set_profile_privacy(p_key text, p_value boolean)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.profiles
  set privacy = privacy || jsonb_build_object(p_key, p_value)
  where id = (select auth.uid()) and p_key in ('uid', 'roster', 'favorites', 'wishes', 'connections')
  returning privacy;
$$;

revoke all on function public.set_profile_privacy(text, boolean) from public, anon;
grant execute on function public.set_profile_privacy(text, boolean) to authenticated;

create function public.set_friend_requests(p_value text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.profiles
  set privacy = privacy || jsonb_build_object('requests', p_value)
  where id = (select auth.uid()) and p_value in ('everyone', 'followed', 'nobody')
  returning privacy;
$$;

revoke all on function public.set_friend_requests(text) from public, anon;
grant execute on function public.set_friend_requests(text) to authenticated;

create function public.social_can_request(p_actor uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p.privacy->>'requests'
      when 'nobody' then false
      when 'followed' then exists (
        select 1 from public.social_follows f
        where f.follower_id = p_target and f.followee_id = p_actor
      )
      else true
    end
    from public.profiles p where p.id = p_target
  ), true);
$$;

revoke all on function public.social_can_request(uuid, uuid) from public, anon, authenticated;

create or replace function public.social_friend_request(p_user uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.social_write_user();
  v_friend public.social_friendships%rowtype;
begin
  perform public.social_lock_pair(v_user, p_user);
  perform public.social_target(v_user, p_user);
  select * into v_friend from public.social_friendships f
  where (f.requester_id = v_user and f.addressee_id = p_user)
    or (f.requester_id = p_user and f.addressee_id = v_user)
  for update;
  if not found then
    if not public.social_can_request(v_user, p_user) then
      raise exception using errcode = 'P0001', message = 'social:requests_closed';
    end if;
    insert into public.social_friendships (requester_id, addressee_id, status)
    values (v_user, p_user, 'pending') on conflict do nothing;
    if found then
      perform public.social_rate_limit(v_user, 'friend_request');
      return 'outgoing';
    end if;
    select * into v_friend from public.social_friendships f
    where (f.requester_id = v_user and f.addressee_id = p_user)
      or (f.requester_id = p_user and f.addressee_id = v_user)
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'social:invalid';
    end if;
  end if;
  if v_friend.status = 'accepted' then return 'friends'; end if;
  if v_friend.status = 'pending' then
    if v_friend.requester_id = v_user then return 'outgoing'; end if;
    update public.social_friendships f set status = 'accepted', responded_at = now()
    where f.requester_id = v_friend.requester_id and f.addressee_id = v_friend.addressee_id;
    return 'friends';
  end if;
  if v_friend.requester_id = v_user
    and (v_friend.responded_at is null or v_friend.responded_at >= now() - interval '3 days') then
    raise exception using errcode = 'P0001', message = 'social:cooldown';
  end if;
  if not public.social_can_request(v_user, p_user) then
    raise exception using errcode = 'P0001', message = 'social:requests_closed';
  end if;
  update public.social_friendships f
  set requester_id = v_user, addressee_id = p_user, status = 'pending',
    created_at = now(), responded_at = null
  where f.requester_id = v_friend.requester_id and f.addressee_id = v_friend.addressee_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'social:invalid';
  end if;
  perform public.social_rate_limit(v_user, 'friend_request');
  return 'outgoing';
end;
$$;

create or replace function public.social_relation(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_friend text := 'none';
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'social:auth_required';
  end if;
  select case when f.status = 'accepted' then 'friends'
    when f.status = 'pending' and f.requester_id = v_user then 'outgoing'
    when f.status = 'pending' then 'incoming'
    when f.requester_id = v_user then 'declined' else 'none' end
  into v_friend from public.social_friendships f
  where (f.requester_id = v_user and f.addressee_id = p_user)
    or (f.requester_id = p_user and f.addressee_id = v_user);
  return pg_catalog.jsonb_build_object(
    'following', exists (select 1 from public.social_follows f
      where f.follower_id = v_user and f.followee_id = p_user),
    'followed_by', exists (select 1 from public.social_follows f
      where f.follower_id = p_user and f.followee_id = v_user),
    'friend', coalesce(v_friend, 'none'),
    'blocked', exists (select 1 from public.social_blocks b
      where b.blocker_id = v_user and b.blocked_id = p_user),
    'can_request', public.social_can_request(v_user, p_user)
  );
end;
$$;

create or replace function public.social_list(
  p_user uuid, p_kind text, p_limit int default 30, p_offset int default 0
)
returns table (user_id uuid, author jsonb, since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('followers', 'following', 'friends') then
    raise exception using errcode = 'P0001', message = 'social:invalid';
  end if;
  if auth.uid() is distinct from p_user and not coalesce((
    select (p.privacy->>'connections')::boolean
    from public.profiles p where p.id = p_user
  ), false) then
    return;
  end if;
  return query
  select s.user_id, public.forum_author_json(s.user_id), s.since
  from (
    select f.follower_id as user_id, f.created_at as since
    from public.social_follows f where p_kind = 'followers' and f.followee_id = p_user
    union all
    select f.followee_id, f.created_at
    from public.social_follows f where p_kind = 'following' and f.follower_id = p_user
    union all
    select case when f.requester_id = p_user then f.addressee_id else f.requester_id end,
      f.responded_at
    from public.social_friendships f
    where p_kind = 'friends' and f.status = 'accepted'
      and (f.requester_id = p_user or f.addressee_id = p_user)
  ) s
  join public.profiles p on p.id = s.user_id and p.is_public
  where exists (select 1 from public.profiles owner where owner.id = p_user and owner.is_public)
    and not exists (select 1 from public.social_blocks b
      where b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
  order by s.since desc, s.user_id
  limit least(greatest(coalesce(p_limit, 30), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

drop function public.social_counts(uuid);

create function public.social_counts(p_user uuid)
returns table (followers bigint, following bigint, friends bigint, lists_hidden boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.social_follows f where f.followee_id = p_user),
    (select count(*) from public.social_follows f where f.follower_id = p_user),
    (select count(*) from public.social_friendships f
      where f.status = 'accepted' and (f.requester_id = p_user or f.addressee_id = p_user)),
    auth.uid() is distinct from p_user
      and not coalesce((p.privacy->>'connections')::boolean, false)
  from public.profiles p where p.id = p_user and p.is_public;
$$;

revoke all on function public.social_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.social_relation(uuid) from public, anon, authenticated;
revoke all on function public.social_list(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.social_counts(uuid) from public, anon, authenticated;

grant execute on function public.social_friend_request(uuid) to authenticated;
grant execute on function public.social_relation(uuid) to authenticated;
grant execute on function public.social_list(uuid, text, int, int) to anon, authenticated;
grant execute on function public.social_counts(uuid) to anon, authenticated;

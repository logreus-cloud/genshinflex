create table public.social_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index social_follows_followee_idx on public.social_follows (followee_id, created_at desc);

create table public.social_friendships (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index social_friendships_pair_idx
on public.social_friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index social_friendships_addressee_idx on public.social_friendships (addressee_id, status);
create index social_friendships_requester_idx on public.social_friendships (requester_id, status);

create table public.social_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index social_blocks_blocked_idx on public.social_blocks (blocked_id);

create table public.social_rate_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('follow', 'friend_request')),
  created_at timestamptz not null default now()
);
create index social_rate_events_user_idx
on public.social_rate_events (user_id, kind, created_at);

alter table public.social_follows enable row level security;
alter table public.social_friendships enable row level security;
alter table public.social_blocks enable row level security;
alter table public.social_rate_events enable row level security;

revoke all on public.social_follows, public.social_friendships, public.social_blocks,
  public.social_rate_events from public, anon, authenticated;
grant all on public.social_follows, public.social_friendships, public.social_blocks,
  public.social_rate_events to service_role;

create function public.social_write_user()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'social:auth_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('social:' || v_user::text));
  return v_user;
end;
$$;

create function public.social_lock_pair(a uuid, b uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'social:' || least(a, b)::text || ':' || greatest(a, b)::text));
end;
$$;

create function public.social_target(p_actor uuid, p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user = p_actor then
    raise exception using errcode = 'P0001', message = 'social:self';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_user and p.is_public
  ) then
    raise exception using errcode = 'P0001', message = 'social:not_found';
  end if;
  if exists (
    select 1 from public.social_blocks b
    where (b.blocker_id = p_actor and b.blocked_id = p_user)
      or (b.blocker_id = p_user and b.blocked_id = p_actor)
  ) then
    raise exception using errcode = 'P0001', message = 'social:unavailable';
  end if;
end;
$$;

create function public.social_rate_limit(p_actor uuid, p_kind text)
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

create function public.social_follow(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.social_write_user();
begin
  perform public.social_lock_pair(v_user, p_user);
  if exists (select 1 from public.social_follows f
    where f.follower_id = v_user and f.followee_id = p_user) then
    return;
  end if;
  perform public.social_target(v_user, p_user);
  insert into public.social_follows (follower_id, followee_id)
  values (v_user, p_user) on conflict do nothing;
  if found then
    perform public.social_rate_limit(v_user, 'follow');
  end if;
end;
$$;

create function public.social_unfollow(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.social_write_user();
begin
  perform public.social_lock_pair(v_user, p_user);
  delete from public.social_follows f
  where f.follower_id = v_user and f.followee_id = p_user;
end;
$$;

create function public.social_friend_request(p_user uuid)
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

create function public.social_friend_respond(p_user uuid, p_accept boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.social_write_user();
begin
  perform public.social_lock_pair(v_user, p_user);
  update public.social_friendships f
  set status = case when p_accept then 'accepted' else 'declined' end,
    responded_at = now()
  where f.requester_id = p_user and f.addressee_id = v_user and f.status = 'pending';
  if not found then
    raise exception using errcode = 'P0001', message = 'social:not_found';
  end if;
end;
$$;

create function public.social_friend_remove(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.social_write_user();
begin
  perform public.social_lock_pair(v_user, p_user);
  delete from public.social_friendships f
  where ((f.requester_id = v_user and f.addressee_id = p_user)
    or (f.requester_id = p_user and f.addressee_id = v_user))
    and (f.status = 'accepted' or (f.status = 'pending' and f.requester_id = v_user));
end;
$$;

create function public.social_block(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.social_write_user();
begin
  perform public.social_lock_pair(v_user, p_user);
  if p_user = v_user then
    raise exception using errcode = 'P0001', message = 'social:self';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception using errcode = 'P0001', message = 'social:not_found';
  end if;
  insert into public.social_blocks (blocker_id, blocked_id)
  values (v_user, p_user) on conflict do nothing;
  delete from public.social_follows f
  where (f.follower_id = v_user and f.followee_id = p_user)
    or (f.follower_id = p_user and f.followee_id = v_user);
  delete from public.social_friendships f
  where (f.requester_id = v_user and f.addressee_id = p_user)
    or (f.requester_id = p_user and f.addressee_id = v_user);
end;
$$;

create function public.social_unblock(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.social_write_user();
begin
  perform public.social_lock_pair(v_user, p_user);
  delete from public.social_blocks b where b.blocker_id = v_user and b.blocked_id = p_user;
end;
$$;

create function public.social_relation(p_user uuid)
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
      where b.blocker_id = v_user and b.blocked_id = p_user)
  );
end;
$$;

create function public.social_counts(p_user uuid)
returns table (followers bigint, following bigint, friends bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.social_follows f where f.followee_id = p_user),
    (select count(*) from public.social_follows f where f.follower_id = p_user),
    (select count(*) from public.social_friendships f
      where f.status = 'accepted' and (f.requester_id = p_user or f.addressee_id = p_user))
  where exists (select 1 from public.profiles p where p.id = p_user and p.is_public);
$$;

create function public.social_list(
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

create function public.social_requests(
  p_direction text, p_limit int default 30, p_offset int default 0
)
returns table (user_id uuid, author jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'social:auth_required';
  end if;
  if p_direction is null or p_direction not in ('incoming', 'outgoing') then
    raise exception using errcode = 'P0001', message = 'social:invalid';
  end if;
  return query
  select case when p_direction = 'incoming' then f.requester_id else f.addressee_id end,
    public.forum_author_json(case when p_direction = 'incoming' then f.requester_id else f.addressee_id end),
    f.created_at
  from public.social_friendships f
  where f.status = 'pending'
    and ((p_direction = 'incoming' and f.addressee_id = v_user)
      or (p_direction = 'outgoing' and f.requester_id = v_user))
  order by f.created_at desc, f.requester_id, f.addressee_id
  limit least(greatest(coalesce(p_limit, 30), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function public.social_blocked(p_limit int default 30, p_offset int default 0)
returns table (user_id uuid, author jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'social:auth_required';
  end if;
  return query
  select b.blocked_id, public.forum_author_json(b.blocked_id), b.created_at
  from public.social_blocks b where b.blocker_id = v_user
  order by b.created_at desc, b.blocked_id
  limit least(greatest(coalesce(p_limit, 30), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.social_write_user() from public, anon, authenticated;
revoke all on function public.social_lock_pair(uuid, uuid) from public, anon, authenticated;
revoke all on function public.social_target(uuid, uuid) from public, anon, authenticated;
revoke all on function public.social_rate_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.social_follow(uuid) from public, anon, authenticated;
revoke all on function public.social_unfollow(uuid) from public, anon, authenticated;
revoke all on function public.social_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.social_friend_respond(uuid, boolean) from public, anon, authenticated;
revoke all on function public.social_friend_remove(uuid) from public, anon, authenticated;
revoke all on function public.social_block(uuid) from public, anon, authenticated;
revoke all on function public.social_unblock(uuid) from public, anon, authenticated;
revoke all on function public.social_relation(uuid) from public, anon, authenticated;
revoke all on function public.social_counts(uuid) from public, anon, authenticated;
revoke all on function public.social_list(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.social_requests(text, int, int) from public, anon, authenticated;
revoke all on function public.social_blocked(int, int) from public, anon, authenticated;

grant execute on function public.social_follow(uuid) to authenticated;
grant execute on function public.social_unfollow(uuid) to authenticated;
grant execute on function public.social_friend_request(uuid) to authenticated;
grant execute on function public.social_friend_respond(uuid, boolean) to authenticated;
grant execute on function public.social_friend_remove(uuid) to authenticated;
grant execute on function public.social_block(uuid) to authenticated;
grant execute on function public.social_unblock(uuid) to authenticated;
grant execute on function public.social_relation(uuid) to authenticated;
grant execute on function public.social_counts(uuid) to anon, authenticated;
grant execute on function public.social_list(uuid, text, int, int) to anon, authenticated;
grant execute on function public.social_requests(text, int, int) to authenticated;
grant execute on function public.social_blocked(int, int) to authenticated;

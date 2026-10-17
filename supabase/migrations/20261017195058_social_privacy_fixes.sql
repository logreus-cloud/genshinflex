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
  join public.profiles p on p.id = s.user_id and (p.is_public or auth.uid() = p_user)
  where exists (select 1 from public.profiles owner
    where owner.id = p_user and (owner.is_public or auth.uid() = p_user))
    and (auth.uid() = p_user or not exists (select 1 from public.social_blocks b
      where b.blocker_id = auth.uid() and b.blocked_id = s.user_id))
  order by s.since desc, s.user_id
  limit least(greatest(coalesce(p_limit, 30), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.social_counts(p_user uuid)
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
  from public.profiles p where p.id = p_user and (p.is_public or auth.uid() = p_user);
$$;

create or replace function public.social_block(p_user uuid)
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
  if not exists (
    select 1 from public.profiles p
    where p.id = p_user and (
      p.is_public
      or exists (select 1 from public.social_blocks b
        where b.blocker_id = v_user and b.blocked_id = p_user)
      or exists (select 1 from public.forum_threads t
        where t.author_id = p_user and t.deleted_at is null)
      or exists (select 1 from public.forum_posts fp
        join public.forum_threads t on t.id = fp.thread_id
        where fp.author_id = p_user and fp.deleted_at is null and t.deleted_at is null)
      or exists (select 1 from public.dm_members mine
        join public.dm_members theirs on theirs.conversation_id = mine.conversation_id
        where mine.user_id = v_user and theirs.user_id = p_user)
      or exists (select 1 from public.social_follows f
        where (f.follower_id = v_user and f.followee_id = p_user)
          or (f.follower_id = p_user and f.followee_id = v_user))
      or exists (select 1 from public.social_friendships f
        where f.status in ('pending', 'accepted')
          and ((f.requester_id = v_user and f.addressee_id = p_user)
            or (f.requester_id = p_user and f.addressee_id = v_user)))
    )
  ) then
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

create or replace function public.guild_member_list(p_slug text, p_limit int default 50, p_offset int default 0)
returns table (author jsonb, joined_at timestamptz, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select case when not p.is_public and m.user_id is distinct from auth.uid()
    then jsonb_build_object('hidden', true) else public.forum_author_json(m.user_id) end,
    m.joined_at, m.user_id = g.owner_id
  from public.guilds g
  join public.guild_members m on m.guild_id = g.id
  left join public.profiles p on p.id = m.user_id
  where g.slug = p_slug
  order by (m.user_id = g.owner_id) desc, m.joined_at, m.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.guild_get(p_slug text)
returns table (
  slug text, name text, tag text, description text, members int,
  created_at timestamptz, owner jsonb, is_member boolean, my_guild text
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.slug, g.name, g.tag, g.description,
    (select count(*)::int from public.guild_members m where m.guild_id = g.id),
    g.created_at,
    case when not p.is_public and g.owner_id is distinct from auth.uid()
      then jsonb_build_object('hidden', true) else public.forum_author_json(g.owner_id) end,
    exists (select 1 from public.guild_members m where m.guild_id = g.id and m.user_id = auth.uid()),
    (select mg.slug from public.guild_members mm join public.guilds mg on mg.id = mm.guild_id
     where mm.user_id = auth.uid())
  from public.guilds g
  left join public.profiles p on p.id = g.owner_id
  where g.slug = p_slug;
$$;

revoke all on function public.social_list(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.social_counts(uuid) from public, anon, authenticated;
revoke all on function public.social_block(uuid) from public, anon, authenticated;
revoke all on function public.guild_member_list(text, int, int) from public;
revoke all on function public.guild_get(text) from public;
grant execute on function public.social_list(uuid, text, int, int) to anon, authenticated;
grant execute on function public.social_counts(uuid) to anon, authenticated;
grant execute on function public.social_block(uuid) to authenticated;
grant execute on function public.guild_member_list(text, int, int) to anon, authenticated;
grant execute on function public.guild_get(text) to anon, authenticated;

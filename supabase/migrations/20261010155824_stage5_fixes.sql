create or replace function public.guild_lock(p_guild bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('guild-id:' || p_guild::text));
end;
$$;

revoke all on function public.guild_lock(bigint) from public, anon, authenticated;

create or replace function public.guild_settle(p_guild bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  perform public.guild_lock(p_guild);
  if exists (
    select 1 from public.guilds g
    join public.guild_members m on m.user_id = g.owner_id and m.guild_id = g.id
    where g.id = p_guild
  ) then
    return;
  end if;
  select m.user_id into v_next from public.guild_members m
  where m.guild_id = p_guild order by m.joined_at, m.user_id limit 1;
  if v_next is null then
    delete from public.guilds g where g.id = p_guild;
  else
    update public.guilds g set owner_id = v_next where g.id = p_guild;
  end if;
end;
$$;

create or replace function public.guild_join(p_slug text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.guild_user();
  v_id bigint;
begin
  if exists (select 1 from public.guild_members m where m.user_id = v_user) then
    raise exception using errcode = 'P0001', message = 'guild:already_member';
  end if;
  select g.id into v_id from public.guilds g where g.slug = p_slug;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'guild:not_found';
  end if;
  perform public.guild_lock(v_id);
  if not exists (select 1 from public.guilds g where g.id = v_id) then
    raise exception using errcode = 'P0001', message = 'guild:not_found';
  end if;
  insert into public.guild_members (user_id, guild_id) values (v_user, v_id);
end;
$$;

create or replace function public.guild_leave()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.guild_user();
  v_id bigint;
begin
  select m.guild_id into v_id from public.guild_members m where m.user_id = v_user;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'guild:not_member';
  end if;
  perform public.guild_lock(v_id);
  delete from public.guild_members m where m.user_id = v_user;
  if not found then
    raise exception using errcode = 'P0001', message = 'guild:not_member';
  end if;
end;
$$;

create or replace function public.forum_scores()
returns table (user_id uuid, points int, reactions int, replies int, views int)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select p.author_id as user_id, count(*)::int as n
    from public.forum_reactions x
    join public.forum_posts p on p.id = x.post_id
    join public.forum_threads t on t.id = p.thread_id
    where p.deleted_at is null and t.deleted_at is null
      and p.author_id is not null and x.user_id <> p.author_id
    group by p.author_id
  ), a as (
    select t.author_id as user_id, count(*)::int as n
    from public.forum_posts p
    join public.forum_threads t on t.id = p.thread_id
    where p.deleted_at is null and t.deleted_at is null and t.author_id is not null
      and p.author_id is distinct from t.author_id
    group by t.author_id
  ), v as (
    select t.author_id as user_id, count(*)::int as n
    from public.forum_thread_views w
    join public.forum_threads t on t.id = w.thread_id
    where t.deleted_at is null and t.author_id is not null
    group by t.author_id
  ), u as (
    select user_id from r union select user_id from a union select user_id from v
  )
  select u.user_id,
    (coalesce(r.n, 0) * 2 + coalesce(a.n, 0) + coalesce(v.n, 0) / 10)::int,
    coalesce(r.n, 0), coalesce(a.n, 0), coalesce(v.n, 0)
  from u
  left join r on r.user_id = u.user_id
  left join a on a.user_id = u.user_id
  left join v on v.user_id = u.user_id;
$$;

create or replace function public.forum_user_score(p_user uuid)
returns table (points int, reactions int, replies int, views int, place int)
language sql
stable
security definer
set search_path = ''
as $$
  with scores as (
    select * from public.forum_scores()
  ), ranked as (
    select s.user_id, rank() over (order by s.points desc)::int as place
    from scores s
    join public.profiles p on p.id = s.user_id and p.is_public
    where s.points > 0
  )
  select coalesce(s.points, 0), coalesce(s.reactions, 0), coalesce(s.replies, 0),
    coalesce(s.views, 0), r.place
  from public.profiles p
  left join scores s on s.user_id = p.id
  left join ranked r on r.user_id = p.id
  where p.id = p_user and (p.is_public or p.id = auth.uid());
$$;

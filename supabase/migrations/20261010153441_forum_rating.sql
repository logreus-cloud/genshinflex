-- Просмотры тем: один вошедший пользователь — один просмотр темы в день
create table public.forum_thread_views (
  thread_id bigint not null references public.forum_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  primary key (thread_id, user_id, day)
);
create index forum_thread_views_user_idx on public.forum_thread_views (user_id);

alter table public.forum_thread_views enable row level security;
revoke all on public.forum_thread_views from public, anon, authenticated;
grant all on public.forum_thread_views to service_role;

create function public.forum_view(p_thread bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;
  insert into public.forum_thread_views (thread_id, user_id)
  select t.id, v_user from public.forum_threads t
  where t.id = p_thread and t.deleted_at is null and t.author_id is distinct from v_user
  on conflict do nothing;
end;
$$;

-- Очки: реакция другого на пост +2, ответ другого в теме +1, каждые 10 просмотров тем +1
create function public.forum_scores()
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
    where p.deleted_at is null and p.author_id is not null and x.user_id <> p.author_id
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

create function public.forum_leaderboard(p_limit int default 50, p_offset int default 0)
returns table (author jsonb, points int, reactions int, replies int, views int)
language sql
stable
security definer
set search_path = ''
as $$
  select public.forum_author_json(s.user_id), s.points, s.reactions, s.replies, s.views
  from public.forum_scores() s
  join public.profiles p on p.id = s.user_id and p.is_public
  where s.points > 0
  order by s.points desc, s.reactions desc, p.nickname
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Очки конкретного пользователя: публичный профиль или свой
create function public.forum_user_score(p_user uuid)
returns table (points int, reactions int, replies int, views int, place int)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select s.*, rank() over (order by s.points desc)::int as place
    from public.forum_scores() s where s.points > 0
  )
  select coalesce(r.points, 0), coalesce(r.reactions, 0), coalesce(r.replies, 0),
    coalesce(r.views, 0), r.place
  from public.profiles p
  left join ranked r on r.user_id = p.id
  where p.id = p_user and (p.is_public or p.id = auth.uid());
$$;

revoke all on function public.forum_view(bigint) from public, anon, authenticated;
revoke all on function public.forum_scores() from public, anon, authenticated;
revoke all on function public.forum_leaderboard(int, int) from public, anon, authenticated;
revoke all on function public.forum_user_score(uuid) from public, anon, authenticated;
grant execute on function public.forum_view(bigint) to authenticated;
grant execute on function public.forum_leaderboard(int, int) to anon, authenticated;
grant execute on function public.forum_user_score(uuid) to anon, authenticated;

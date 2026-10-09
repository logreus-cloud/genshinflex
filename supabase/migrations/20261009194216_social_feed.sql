create function public.social_feed(
  p_before_at timestamptz default null, p_before_id bigint default null,
  p_limit int default 20
)
returns table (
  id bigint, thread_id bigint, thread_title text, is_thread boolean,
  body text, created_at timestamptz, author jsonb
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
    raise exception using errcode = 'P0001', message = 'social:auth_required';
  end if;
  return query
  select p.id, p.thread_id, t.title,
    p.id = (select min(fp.id) from public.forum_posts fp where fp.thread_id = p.thread_id),
    left(p.body, 300), p.created_at, public.forum_author_json(p.author_id)
  from public.social_follows f
  join public.forum_posts p on p.author_id = f.followee_id
  join public.forum_threads t on t.id = p.thread_id
  where f.follower_id = v_user
    and p.deleted_at is null and t.deleted_at is null
    and not exists (
      select 1 from public.social_blocks b
      where (b.blocker_id = v_user and b.blocked_id = p.author_id)
        or (b.blocker_id = p.author_id and b.blocked_id = v_user)
    )
    and (p_before_at is null
      or (p.created_at, p.id) < (p_before_at, p_before_id))
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.social_feed(timestamptz, bigint, int) from public, anon, authenticated;
grant execute on function public.social_feed(timestamptz, bigint, int) to authenticated;

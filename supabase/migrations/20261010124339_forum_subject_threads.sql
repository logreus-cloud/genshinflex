create function public.forum_subject_threads(
  p_kind text, p_id text, p_limit int default 5, p_offset int default 0
)
returns table (
  id bigint, category text, title text, lang text, pinned boolean,
  locked boolean, deleted boolean, subject_kind text, subject_id text,
  post_count int, last_post_at timestamptz, created_at timestamptz, author jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.category, t.title, t.lang, t.pinned, t.locked,
    t.deleted_at is not null, t.subject_kind, t.subject_id,
    t.post_count, t.last_post_at, t.created_at,
    public.forum_author_json(t.author_id)
  from public.forum_threads t
  where t.subject_kind = p_kind and t.subject_id = p_id
    and t.deleted_at is null
  order by t.last_post_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 5), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.forum_subject_threads(text, text, int, int) from public;
grant execute on function public.forum_subject_threads(text, text, int, int) to anon, authenticated;

create table public.forum_categories (
  slug text primary key check (slug ~ '^[a-z-]{2,32}$'),
  sort int not null,
  mod_only boolean not null default false
);

insert into public.forum_categories (slug, sort, mod_only)
values
  ('announcements', 1, true),
  ('builds', 2, false),
  ('endgame', 3, false),
  ('wishes', 4, false),
  ('lore', 5, false),
  ('site', 6, false),
  ('offtopic', 7, false);

create table public.forum_threads (
  id bigint generated always as identity primary key,
  category text not null references public.forum_categories(slug),
  author_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  lang text not null check (lang in ('ru', 'en', 'es')),
  pinned boolean not null default false,
  locked boolean not null default false,
  subject_kind text check (subject_kind in ('character', 'rotation', 'build')),
  subject_id text check (char_length(subject_id) <= 80),
  post_count int not null default 0,
  last_post_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  check ((subject_kind is null) = (subject_id is null))
);

create index forum_threads_category_idx
on public.forum_threads (category, pinned desc, last_post_at desc)
where deleted_at is null;
create index forum_threads_author_idx on public.forum_threads (author_id);
create index forum_threads_subject_idx on public.forum_threads (subject_kind, subject_id);

create table public.forum_posts (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.forum_threads(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 10000),
  reply_to bigint references public.forum_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  delete_reason text check (char_length(delete_reason) <= 200)
);

create index forum_posts_thread_idx on public.forum_posts (thread_id, id);
create index forum_posts_author_idx on public.forum_posts (author_id, created_at desc);

create table public.forum_reactions (
  post_id bigint not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('like', 'heart', 'fire', 'laugh', 'think', 'sad')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);

create table public.forum_reports (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.forum_posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'spoiler', 'offtopic', 'other')),
  comment text check (char_length(comment) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  submissions int not null default 1,
  last_submitted_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);

create table public.forum_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until timestamptz,
  reason text check (char_length(reason) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.forum_categories enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_posts enable row level security;
alter table public.forum_reactions enable row level security;
alter table public.forum_reports enable row level security;
alter table public.forum_bans enable row level security;

revoke all on public.forum_categories, public.forum_threads, public.forum_posts,
  public.forum_reactions, public.forum_reports, public.forum_bans
from public, anon, authenticated;
grant all on public.forum_categories, public.forum_threads, public.forum_posts,
  public.forum_reactions, public.forum_reports, public.forum_bans to service_role;
grant all on sequence public.forum_threads_id_seq, public.forum_posts_id_seq,
  public.forum_reports_id_seq to service_role;

create function public.forum_is_moderator(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roles r
    where r.user_id = p_user and r.role in ('admin', 'moderator')
  );
$$;

create function public.forum_author_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_user is null then null else (
    select jsonb_build_object(
      'id', p.id,
      'nickname', p.nickname::text,
      'name', coalesce(nullif(btrim(p.custom->>'nick'), ''), p.display_name, p.nickname::text),
      'public', p.is_public,
      'custom', case when p.is_public then p.custom else null end,
      'title', p.active_title,
      'moderator', public.forum_is_moderator(p.id)
    )
    from public.profiles p
    where p.id = p_user
  ) end;
$$;

create function public.forum_write_user()
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
    raise exception using errcode = 'P0001', message = 'forum:auth_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('forum:' || v_user::text));
  if exists (
    select 1 from public.forum_bans b
    where b.user_id = v_user and (b.until is null or b.until > now())
  ) then
    raise exception using errcode = 'P0001', message = 'forum:banned';
  end if;
  return v_user;
end;
$$;

create function public.forum_check_links(p_user uuid, p_text text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.forum_is_moderator(p_user)
    and p_text ~* '(https?://|www\.)'
    and exists (
      select 1 from auth.users u
      where u.id = p_user and u.created_at > now() - interval '3 days'
    )
  then
    raise exception using errcode = 'P0001', message = 'forum:links_not_allowed';
  end if;
end;
$$;

create function public.forum_check_post_limit(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if public.forum_is_moderator(p_user) then
    return;
  end if;
  if exists (
    select 1 from public.forum_posts p
    where p.author_id = p_user and p.created_at > now() - interval '15 seconds'
  ) or (
    select count(*) from public.forum_posts p
    where p.author_id = p_user and p.created_at > now() - interval '1 hour'
  ) >= 40 then
    raise exception using errcode = 'P0001', message = 'forum:rate_limited';
  end if;
end;
$$;

create function public.forum_recount_thread(p_thread bigint)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.forum_threads t
  set post_count = (
    select count(*)::int from public.forum_posts p
    where p.thread_id = p_thread and p.deleted_at is null
  ),
  last_post_at = coalesce((
    select max(p.created_at) from public.forum_posts p
    where p.thread_id = p_thread and p.deleted_at is null
  ), t.created_at)
  where t.id = p_thread;
$$;

create function public.forum_category_stats()
returns table (
  slug text, sort int, mod_only boolean, thread_count bigint,
  post_count bigint, last_thread_id bigint, last_thread_title text,
  last_post_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.slug, c.sort, c.mod_only,
    count(t.id), coalesce(sum(t.post_count), 0)::bigint,
    (array_agg(t.id order by t.last_post_at desc, t.id desc)
      filter (where t.id is not null))[1],
    (array_agg(t.title order by t.last_post_at desc, t.id desc)
      filter (where t.id is not null))[1],
    max(t.last_post_at)
  from public.forum_categories c
  left join public.forum_threads t on t.category = c.slug and t.deleted_at is null
  group by c.slug, c.sort, c.mod_only
  order by c.sort;
$$;

create function public.forum_threads(
  p_category text default null, p_lang text default null,
  p_limit int default 30, p_offset int default 0
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
  where (p_category is null or t.category = p_category)
    and (p_lang is null or t.lang = p_lang)
    and (t.deleted_at is null or public.forum_is_moderator(auth.uid()))
  order by case when p_category is not null then t.pinned end desc nulls last,
    t.last_post_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 30), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.forum_thread(p_id bigint)
returns table (
  id bigint, category text, title text, lang text, pinned boolean,
  locked boolean, deleted boolean, subject_kind text, subject_id text,
  post_count int, last_post_at timestamptz, created_at timestamptz,
  author jsonb, first_post_id bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.category, t.title, t.lang, t.pinned, t.locked,
    t.deleted_at is not null, t.subject_kind, t.subject_id,
    t.post_count, t.last_post_at, t.created_at,
    public.forum_author_json(t.author_id),
    (select min(p.id) from public.forum_posts p where p.thread_id = t.id)
  from public.forum_threads t
  where t.id = p_id
    and (t.deleted_at is null or public.forum_is_moderator(auth.uid()));
$$;

create function public.forum_posts(
  p_thread bigint, p_limit int default 30, p_offset int default 0
)
returns table (
  id bigint, thread_id bigint, reply_to bigint, created_at timestamptz,
  edited_at timestamptz, deleted boolean, body text, delete_reason text,
  author jsonb, reactions jsonb, my_reactions text[], mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.thread_id, p.reply_to, p.created_at, p.edited_at,
    p.deleted_at is not null,
    case when p.deleted_at is null or public.forum_is_moderator(auth.uid())
      then p.body else null end,
    case when public.forum_is_moderator(auth.uid()) then p.delete_reason else null end,
    case when p.deleted_at is null or public.forum_is_moderator(auth.uid())
      then public.forum_author_json(p.author_id) else null end,
    coalesce((
      select jsonb_object_agg(r.kind, r.total)
      from (
        select fr.kind, count(*)::int as total
        from public.forum_reactions fr
        where fr.post_id = p.id
        group by fr.kind
      ) r
    ), '{}'::jsonb),
    coalesce((
      select array_agg(fr.kind order by fr.kind)
      from public.forum_reactions fr
      where fr.post_id = p.id and fr.user_id = auth.uid()
    ), array[]::text[]),
    coalesce(p.author_id = auth.uid(), false)
  from public.forum_posts p
  join public.forum_threads t on t.id = p.thread_id
  where p.thread_id = p_thread
    and (t.deleted_at is null or public.forum_is_moderator(auth.uid()))
  order by p.id
  limit least(greatest(coalesce(p_limit, 30), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.forum_user_posts(
  p_nickname text, p_limit int default 20, p_offset int default 0
)
returns table (
  id bigint, thread_id bigint, thread_title text, body text, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.thread_id, t.title, left(p.body, 300), p.created_at
  from public.profiles u
  join public.forum_posts p on p.author_id = u.id
  join public.forum_threads t on t.id = p.thread_id
  where u.nickname operator(extensions.=) p_nickname::extensions.citext
    and u.is_public and p.deleted_at is null and t.deleted_at is null
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.forum_me()
returns table (
  moderator boolean, banned_until timestamptz, banned boolean,
  ban_reason text, links_allowed boolean
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
    raise exception using errcode = 'P0001', message = 'forum:auth_required';
  end if;
  return query
  select public.forum_is_moderator(v_user), b.until,
    b.user_id is not null and (b.until is null or b.until > now()),
    b.reason,
    public.forum_is_moderator(v_user)
      or u.created_at <= now() - interval '3 days'
  from auth.users u
  left join public.forum_bans b on b.user_id = u.id
  where u.id = v_user;
end;
$$;

create function public.forum_reports_queue(
  p_status text default 'open', p_limit int default 30, p_offset int default 0
)
returns table (
  id bigint, post_id bigint, thread_id bigint, thread_title text,
  post_body text, post_deleted boolean, reason text, comment text,
  status text, created_at timestamptz, reporter jsonb, author jsonb,
  reports_on_post int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.forum_is_moderator(auth.uid()) then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if p_status is not null and p_status not in ('open', 'resolved', 'dismissed') then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  return query
  select r.id, r.post_id, p.thread_id, t.title, left(p.body, 300),
    p.deleted_at is not null, r.reason, r.comment, r.status, r.created_at,
    public.forum_author_json(r.reporter_id),
    public.forum_author_json(p.author_id),
    (select count(*)::int from public.forum_reports other where other.post_id = p.id)
  from public.forum_reports r
  join public.forum_posts p on p.id = r.post_id
  join public.forum_threads t on t.id = p.thread_id
  where p_status is null or r.status = p_status
  order by r.created_at, r.id
  limit least(greatest(coalesce(p_limit, 30), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function public.forum_create_thread(
  p_category text, p_title text, p_body text, p_lang text,
  p_subject_kind text default null, p_subject_id text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_mod boolean := public.forum_is_moderator(v_user);
  v_mod_only boolean;
  v_thread bigint;
begin
  if p_title is null or char_length(btrim(p_title)) not between 3 and 120
    or p_body is null or char_length(p_body) not between 1 and 10000
    or p_lang is null or p_lang not in ('ru', 'en', 'es')
    or ((p_subject_kind is null) <> (p_subject_id is null))
    or (p_subject_kind is not null and p_subject_kind not in ('character', 'rotation', 'build'))
    or (p_subject_id is not null and char_length(p_subject_id) > 80)
  then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  select c.mod_only into v_mod_only
  from public.forum_categories c where c.slug = p_category;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_mod_only and not v_mod then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if not v_mod and (
    (select count(*) from public.forum_threads t
      where t.author_id = v_user and t.created_at > now() - interval '10 minutes') >= 3
    or (select count(*) from public.forum_threads t
      where t.author_id = v_user and t.created_at > now() - interval '1 day') >= 10
  ) then
    raise exception using errcode = 'P0001', message = 'forum:rate_limited';
  end if;
  perform public.forum_check_post_limit(v_user);
  perform public.forum_check_links(v_user, p_title || ' ' || p_body);
  insert into public.forum_threads (
    category, author_id, title, lang, subject_kind, subject_id, post_count
  ) values (
    p_category, v_user, btrim(p_title), p_lang, p_subject_kind, p_subject_id, 1
  ) returning id into v_thread;
  insert into public.forum_posts (thread_id, author_id, body)
  values (v_thread, v_user, p_body);
  return v_thread;
end;
$$;

create function public.forum_create_post(
  p_thread bigint, p_body text, p_reply_to bigint default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_mod boolean := public.forum_is_moderator(v_user);
  v_thread public.forum_threads%rowtype;
  v_post bigint;
  v_created_at timestamptz;
begin
  select * into v_thread from public.forum_threads t where t.id = p_thread for update;
  if not found or (v_thread.deleted_at is not null and not v_mod) then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_thread.locked and not v_mod then
    raise exception using errcode = 'P0001', message = 'forum:locked';
  end if;
  if p_body is null or char_length(p_body) not between 1 and 10000 then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  if p_reply_to is not null then
    perform 1 from public.forum_posts p
    where p.id = p_reply_to and p.thread_id = p_thread and p.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'forum:invalid';
    end if;
  end if;
  perform public.forum_check_post_limit(v_user);
  perform public.forum_check_links(v_user, p_body);
  insert into public.forum_posts (thread_id, author_id, body, reply_to)
  values (p_thread, v_user, p_body, p_reply_to) returning id, created_at into v_post, v_created_at;
  update public.forum_threads t
  set post_count = t.post_count + 1, last_post_at = greatest(t.last_post_at, v_created_at)
  where t.id = p_thread;
  return v_post;
end;
$$;

create function public.forum_edit_post(p_post bigint, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_post public.forum_posts%rowtype;
  v_thread public.forum_threads%rowtype;
begin
  select t.* into v_thread
  from public.forum_threads t
  join public.forum_posts p on p.thread_id = t.id
  where p.id = p_post for update of t;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  select * into v_post from public.forum_posts p where p.id = p_post for update;
  if not found or v_post.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_thread.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_post.author_id is distinct from v_user then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if v_thread.locked then
    raise exception using errcode = 'P0001', message = 'forum:locked';
  end if;
  if p_body is null or char_length(p_body) not between 1 and 10000 then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  perform public.forum_check_links(v_user, p_body);
  update public.forum_posts p set body = p_body, edited_at = now() where p.id = p_post;
end;
$$;

create function public.forum_edit_thread(p_thread bigint, p_title text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_thread public.forum_threads%rowtype;
  v_mod boolean := public.forum_is_moderator(v_user);
begin
  select * into v_thread from public.forum_threads t where t.id = p_thread for update;
  if not found or (v_thread.deleted_at is not null and not v_mod) then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_thread.author_id is distinct from v_user and not v_mod then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 120 then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  perform public.forum_check_links(v_user, p_title);
  update public.forum_threads t set title = btrim(p_title) where t.id = p_thread;
end;
$$;

create function public.forum_delete_post(p_post bigint, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_post public.forum_posts%rowtype;
  v_thread public.forum_threads%rowtype;
  v_first bigint;
  v_mod boolean := public.forum_is_moderator(v_user);
begin
  select t.* into v_thread
  from public.forum_threads t
  join public.forum_posts p on p.thread_id = t.id
  where p.id = p_post for update of t;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  select * into v_post from public.forum_posts p where p.id = p_post for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if not v_mod and (v_post.author_id is distinct from v_user
    or v_thread.deleted_at is not null) then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if p_reason is not null and char_length(p_reason) > 200 then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  if v_post.deleted_at is not null then
    return;
  end if;
  select min(p.id) into v_first from public.forum_posts p
  where p.thread_id = v_post.thread_id;
  update public.forum_posts p
  set deleted_at = now(), deleted_by = v_user, delete_reason = p_reason
  where p.id = p_post;
  if p_post = v_first then
    update public.forum_threads t
    set deleted_at = now(), deleted_by = v_user
    where t.id = v_post.thread_id;
  end if;
  perform public.forum_recount_thread(v_post.thread_id);
end;
$$;

create function public.forum_restore_post(p_post bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_post public.forum_posts%rowtype;
  v_thread public.forum_threads%rowtype;
  v_first bigint;
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  select t.* into v_thread
  from public.forum_threads t
  join public.forum_posts p on p.thread_id = t.id
  where p.id = p_post for update of t;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  select * into v_post from public.forum_posts p where p.id = p_post for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_post.deleted_at is null then
    return;
  end if;
  select min(p.id) into v_first from public.forum_posts p
  where p.thread_id = v_post.thread_id;
  update public.forum_posts p
  set deleted_at = null, deleted_by = null, delete_reason = null
  where p.id = p_post;
  if p_post = v_first then
    update public.forum_threads t
    set deleted_at = null, deleted_by = null
    where t.id = v_post.thread_id;
  end if;
  perform public.forum_recount_thread(v_post.thread_id);
end;
$$;

create function public.forum_moderate_thread(
  p_thread bigint, p_pinned boolean default null, p_locked boolean default null,
  p_deleted boolean default null, p_category text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if not exists (select 1 from public.forum_threads t where t.id = p_thread) then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if p_category is not null and not exists (
    select 1 from public.forum_categories c where c.slug = p_category
  ) then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  update public.forum_threads t
  set pinned = coalesce(p_pinned, t.pinned),
    locked = coalesce(p_locked, t.locked),
    category = coalesce(p_category, t.category),
    deleted_at = case when p_deleted is null then t.deleted_at
      when p_deleted then coalesce(t.deleted_at, now()) else null end,
    deleted_by = case when p_deleted is null then t.deleted_by
      when p_deleted then coalesce(t.deleted_by, v_user) else null end
  where t.id = p_thread;
end;
$$;

create function public.forum_set_reaction(p_post bigint, p_kind text, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_mod boolean := public.forum_is_moderator(v_user);
begin
  if p_kind is null or p_kind not in ('like', 'heart', 'fire', 'laugh', 'think', 'sad')
    or p_on is null then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  if not exists (
    select 1 from public.forum_posts p
    join public.forum_threads t on t.id = p.thread_id
    where p.id = p_post and p.deleted_at is null
      and (t.deleted_at is null or v_mod)
  ) then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if p_on then
    if not v_mod and not exists (
      select 1 from public.forum_reactions r
      where r.post_id = p_post and r.user_id = v_user and r.kind = p_kind
    ) and (
      select count(*) from public.forum_reactions r
      where r.user_id = v_user and r.created_at > now() - interval '1 minute'
    ) >= 60 then
      raise exception using errcode = 'P0001', message = 'forum:rate_limited';
    end if;
    insert into public.forum_reactions (post_id, user_id, kind)
    values (p_post, v_user, p_kind) on conflict do nothing;
  else
    delete from public.forum_reactions r
    where r.post_id = p_post and r.user_id = v_user and r.kind = p_kind;
  end if;
end;
$$;

create function public.forum_report(
  p_post bigint, p_reason text, p_comment text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_author uuid;
begin
  if p_reason is null or p_reason not in ('spam', 'abuse', 'spoiler', 'offtopic', 'other')
    or (p_comment is not null and char_length(p_comment) > 500) then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  select p.author_id into v_author
  from public.forum_posts p
  join public.forum_threads t on t.id = p.thread_id
  where p.id = p_post and p.deleted_at is null and t.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_author = v_user then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  -- Блокировка до проверки статуса: параллельное закрытие модератором видно следующему запросу
  perform 1 from public.forum_reports r
  where r.post_id = p_post and r.reporter_id = v_user for update;
  if exists (
    select 1 from public.forum_reports r
    where r.post_id = p_post and r.reporter_id = v_user
      and r.status <> 'open'
      and r.last_submitted_at > now() - interval '1 day'
  ) then
    raise exception using errcode = 'P0001', message = 'forum:rate_limited';
  end if;
  if not public.forum_is_moderator(v_user) and (
    select coalesce(sum(r.submissions), 0) from public.forum_reports r
    where r.reporter_id = v_user and r.last_submitted_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'forum:rate_limited';
  end if;
  insert into public.forum_reports as r (post_id, reporter_id, reason, comment)
  values (p_post, v_user, p_reason, p_comment)
  on conflict (post_id, reporter_id) do update
  set reason = excluded.reason, comment = excluded.comment,
    status = 'open', resolved_by = null, resolved_at = null,
    submissions = case when r.last_submitted_at > now() - interval '1 hour'
      then r.submissions + 1 else 1 end,
    last_submitted_at = now();
end;
$$;

create function public.forum_resolve_report(p_report bigint, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_post bigint;
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if p_status is null or p_status not in ('resolved', 'dismissed') then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  select r.post_id into v_post from public.forum_reports r where r.id = p_report;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  update public.forum_reports r
  set status = p_status, resolved_by = v_user, resolved_at = now()
  where r.post_id = v_post and (r.status = 'open' or r.id = p_report);
end;
$$;

create function public.forum_ban(p_user uuid, p_until timestamptz, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if p_user = v_user or public.forum_is_moderator(p_user) then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if (p_until is not null and p_until <= now())
    or (p_reason is not null and char_length(p_reason) > 200) then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  insert into public.forum_bans (user_id, until, reason, created_by)
  values (p_user, p_until, p_reason, v_user)
  on conflict (user_id) do update
  set until = excluded.until, reason = excluded.reason,
    created_by = excluded.created_by, created_at = now();
end;
$$;

create function public.forum_unban(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  delete from public.forum_bans b where b.user_id = p_user;
end;
$$;

revoke all on function public.forum_is_moderator(uuid) from public, anon, authenticated;
revoke all on function public.forum_author_json(uuid) from public, anon, authenticated;
revoke all on function public.forum_write_user() from public, anon, authenticated;
revoke all on function public.forum_check_links(uuid, text) from public, anon, authenticated;
revoke all on function public.forum_check_post_limit(uuid) from public, anon, authenticated;
revoke all on function public.forum_recount_thread(bigint) from public, anon, authenticated;

revoke all on function public.forum_category_stats() from public, anon, authenticated;
revoke all on function public.forum_threads(text, text, int, int) from public, anon, authenticated;
revoke all on function public.forum_thread(bigint) from public, anon, authenticated;
revoke all on function public.forum_posts(bigint, int, int) from public, anon, authenticated;
revoke all on function public.forum_user_posts(text, int, int) from public, anon, authenticated;
revoke all on function public.forum_me() from public, anon, authenticated;
revoke all on function public.forum_reports_queue(text, int, int) from public, anon, authenticated;

grant execute on function public.forum_category_stats() to anon, authenticated;
grant execute on function public.forum_threads(text, text, int, int) to anon, authenticated;
grant execute on function public.forum_thread(bigint) to anon, authenticated;
grant execute on function public.forum_posts(bigint, int, int) to anon, authenticated;
grant execute on function public.forum_user_posts(text, int, int) to anon, authenticated;
grant execute on function public.forum_me() to authenticated;
grant execute on function public.forum_reports_queue(text, int, int) to anon, authenticated;

revoke all on function public.forum_create_thread(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.forum_create_post(bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.forum_edit_post(bigint, text) from public, anon, authenticated;
revoke all on function public.forum_edit_thread(bigint, text) from public, anon, authenticated;
revoke all on function public.forum_delete_post(bigint, text) from public, anon, authenticated;
revoke all on function public.forum_restore_post(bigint) from public, anon, authenticated;
revoke all on function public.forum_moderate_thread(bigint, boolean, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.forum_set_reaction(bigint, text, boolean) from public, anon, authenticated;
revoke all on function public.forum_report(bigint, text, text) from public, anon, authenticated;
revoke all on function public.forum_resolve_report(bigint, text) from public, anon, authenticated;
revoke all on function public.forum_ban(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.forum_unban(uuid) from public, anon, authenticated;

grant execute on function public.forum_create_thread(text, text, text, text, text, text) to authenticated;
grant execute on function public.forum_create_post(bigint, text, bigint) to authenticated;
grant execute on function public.forum_edit_post(bigint, text) to authenticated;
grant execute on function public.forum_edit_thread(bigint, text) to authenticated;
grant execute on function public.forum_delete_post(bigint, text) to authenticated;
grant execute on function public.forum_restore_post(bigint) to authenticated;
grant execute on function public.forum_moderate_thread(bigint, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.forum_set_reaction(bigint, text, boolean) to authenticated;
grant execute on function public.forum_report(bigint, text, text) to authenticated;
grant execute on function public.forum_resolve_report(bigint, text) to authenticated;
grant execute on function public.forum_ban(uuid, timestamptz, text) to authenticated;
grant execute on function public.forum_unban(uuid) to authenticated;

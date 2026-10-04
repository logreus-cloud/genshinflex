-- Список аккаунтов для админки: auth.users + профиль, роли, титулы, баны и активность на форуме.
-- Вызывает только API (service_role) после проверки роли admin.
create function public.admin_accounts(
  p_query text default null,
  p_filter text default 'all',
  p_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, providers text[],
  banned_until timestamptz, ban_reason text,
  nickname text, display_name text, is_public boolean,
  roles text[], titles text[],
  forum_banned boolean, forum_ban_until timestamptz, forum_ban_reason text,
  threads bigint, posts bigint, telegram text, total bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(btrim(coalesce(p_query, '')), '') as raw
  ), base as (
    select
      u.id, u.email::text, u.created_at, u.last_sign_in_at,
      coalesce(array(select distinct i.provider::text from auth.identities i where i.user_id = u.id order by 1), '{}') as providers,
      u.banned_until, u.raw_app_meta_data->>'ban_reason' as ban_reason,
      p.nickname::text, p.display_name, p.is_public,
      coalesce(array(select r.role from public.roles r where r.user_id = u.id order by 1), '{}') as roles,
      coalesce(array(select t.title_id from public.user_titles t where t.user_id = u.id order by 1), '{}') as titles,
      (b.user_id is not null and (b.until is null or b.until > now())) as forum_banned,
      b.until as forum_ban_until, b.reason as forum_ban_reason,
      (select count(*) from public.forum_threads ft where ft.author_id = u.id) as threads,
      (select count(*) from public.forum_posts fp where fp.author_id = u.id) as posts,
      tg.username as telegram
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.forum_bans b on b.user_id = u.id
    left join public.telegram_accounts tg on tg.user_id = u.id
    cross join q
    where (p_id is null or u.id = p_id)
      and (q.raw is null
        or u.id::text = lower(q.raw)
        or u.email ilike '%' || replace(replace(replace(q.raw, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or p.nickname::text ilike '%' || replace(replace(replace(q.raw, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or p.display_name ilike '%' || replace(replace(replace(q.raw, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  )
  select base.*, count(*) over () as total
  from base
  where case coalesce(p_filter, 'all')
    when 'banned' then (base.banned_until is not null and base.banned_until > now()) or base.forum_banned
    when 'staff' then cardinality(base.roles) > 0
    else true
  end
  order by base.created_at desc, base.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_accounts(text, text, uuid, int, int) from public, anon, authenticated;
grant execute on function public.admin_accounts(text, text, uuid, int, int) to service_role;

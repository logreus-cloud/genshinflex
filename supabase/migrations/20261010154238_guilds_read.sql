create function public.guild_list(p_limit int default 30, p_offset int default 0)
returns table (slug text, name text, tag text, description text, members int, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select g.slug, g.name, g.tag, g.description,
    (select count(*)::int from public.guild_members m where m.guild_id = g.id) as members,
    g.created_at
  from public.guilds g
  order by members desc, g.created_at, g.id
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.guild_get(p_slug text)
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
    g.created_at, public.forum_author_json(g.owner_id),
    exists (select 1 from public.guild_members m where m.guild_id = g.id and m.user_id = auth.uid()),
    (select mg.slug from public.guild_members mm join public.guilds mg on mg.id = mm.guild_id
     where mm.user_id = auth.uid())
  from public.guilds g where g.slug = p_slug;
$$;

create function public.guild_member_list(p_slug text, p_limit int default 50, p_offset int default 0)
returns table (author jsonb, joined_at timestamptz, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select public.forum_author_json(m.user_id), m.joined_at, m.user_id = g.owner_id
  from public.guilds g
  join public.guild_members m on m.guild_id = g.id
  where g.slug = p_slug
  order by (m.user_id = g.owner_id) desc, m.joined_at, m.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.guild_mine()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select g.slug from public.guild_members m join public.guilds g on g.id = m.guild_id
  where m.user_id = auth.uid();
$$;

create function public.guild_moderate_delete(p_slug text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.forum_is_moderator(auth.uid()) then
    raise exception using errcode = 'P0001', message = 'guild:forbidden';
  end if;
  delete from public.guilds g where g.slug = p_slug;
  if not found then
    raise exception using errcode = 'P0001', message = 'guild:not_found';
  end if;
end;
$$;

-- Тег гильдии рядом с именем везде, где показывается автор
create or replace function public.forum_author_json(p_user uuid)
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
      'moderator', public.forum_is_moderator(p.id),
      'guild', (
        select jsonb_build_object('slug', g.slug, 'tag', g.tag, 'name', g.name)
        from public.guild_members m join public.guilds g on g.id = m.guild_id
        where m.user_id = p.id
      )
    )
    from public.profiles p
    where p.id = p_user
  ) end;
$$;

revoke all on function public.guild_list(int, int) from public;
revoke all on function public.guild_get(text) from public;
revoke all on function public.guild_member_list(text, int, int) from public;
revoke all on function public.guild_mine() from public, anon;
revoke all on function public.guild_moderate_delete(text) from public, anon, authenticated;
grant execute on function public.guild_list(int, int) to anon, authenticated;
grant execute on function public.guild_get(text) to anon, authenticated;
grant execute on function public.guild_member_list(text, int, int) to anon, authenticated;
grant execute on function public.guild_mine() to authenticated;
grant execute on function public.guild_moderate_delete(text) to authenticated;

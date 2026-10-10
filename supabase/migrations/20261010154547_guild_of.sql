create function public.guild_of(p_user uuid)
returns table (slug text, tag text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.slug, g.tag, g.name
  from public.guild_members m
  join public.guilds g on g.id = m.guild_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = p_user and (p.is_public or p.id = auth.uid());
$$;

revoke all on function public.guild_of(uuid) from public;
grant execute on function public.guild_of(uuid) to anon, authenticated;

create function public.discord_profile(p_discord_id text)
returns table (nickname text, is_public boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.nickname::text, p.is_public
  from auth.identities i
  join public.profiles p on p.id = i.user_id
  where i.provider = 'discord' and i.provider_id = p_discord_id
  limit 1;
$$;

revoke all on function public.discord_profile(text) from public, anon, authenticated;
grant execute on function public.discord_profile(text) to service_role;

comment on function public.discord_profile(text) is
  'Находит профиль по привязанному Discord ID только для сервисного клиента.';

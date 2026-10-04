-- id нужен для путей медиа в публичном бакете; сами пути уже видны в Storage.
drop view if exists public.public_profiles;

create view public.public_profiles with (security_invoker = true) as
select id, nickname, display_name, avatar_path, region, lang, bio, created_at, active_title, custom
from public.profiles
where is_public;

revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

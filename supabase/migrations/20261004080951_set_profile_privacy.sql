-- Атомарно меняет один ключ приватности своего профиля: устаревшая вкладка не перезапишет остальные ключи
create or replace function public.set_profile_privacy(p_key text, p_value boolean)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.profiles
  set privacy = privacy || jsonb_build_object(p_key, p_value)
  where id = (select auth.uid()) and p_key in ('uid', 'roster', 'favorites', 'wishes')
  returning privacy;
$$;

revoke all on function public.set_profile_privacy(text, boolean) from public, anon;
grant execute on function public.set_profile_privacy(text, boolean) to authenticated;

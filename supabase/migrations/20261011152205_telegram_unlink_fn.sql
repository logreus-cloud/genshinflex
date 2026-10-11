create or replace function public.telegram_unlink(p_user uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_telegram bigint;
  v_email text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('user:' || p_user::text, 0));
  select telegram_id into v_telegram
  from public.telegram_accounts
  where user_id = p_user;
  if v_telegram is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('telegram:' || v_telegram::text, 0));
  end if;

  select email into v_email
  from auth.users
  where id = p_user
  for update;
  if v_email ~* '^tg\d+(-\d+)?@telegram\.genshinflex\.com$'
    and not exists (
      select 1 from auth.identities
      where user_id = p_user and provider <> 'email'
    ) then
    return 'last_method';
  end if;

  delete from public.telegram_accounts where user_id = p_user;
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'telegram_id'
  where id = p_user;
  return 'ok';
end;
$$;

revoke all on function public.telegram_unlink(uuid) from public, anon, authenticated;
grant execute on function public.telegram_unlink(uuid) to service_role;

create or replace function public.telegram_link(
  p_user uuid, p_telegram bigint, p_username text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_linked bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('user:' || p_user::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('telegram:' || p_telegram::text, 0));

  select user_id
  into v_owner
  from public.telegram_accounts
  where telegram_id = p_telegram;
  if v_owner is not null and v_owner <> p_user then
    return 'telegram_taken';
  end if;

  select telegram_id
  into v_linked
  from public.telegram_accounts
  where user_id = p_user;
  if v_linked is not null and v_linked <> p_telegram then
    return 'telegram_already_linked';
  end if;

  if v_owner is null then
    insert into public.telegram_accounts (telegram_id, user_id, username)
    values (p_telegram, p_user, p_username)
    on conflict do nothing;
    if not found then
      select user_id
      into v_owner
      from public.telegram_accounts
      where telegram_id = p_telegram;
      if v_owner is not null and v_owner <> p_user then
        return 'telegram_taken';
      end if;
      select telegram_id
      into v_linked
      from public.telegram_accounts
      where user_id = p_user;
      if v_linked is not null and v_linked <> p_telegram then
        return 'telegram_already_linked';
      end if;
      if v_owner is null then
        raise exception 'Telegram link conflict';
      end if;
    end if;
  end if;

  update public.telegram_accounts
  set username = p_username, updated_at = now()
  where telegram_id = p_telegram and user_id = p_user;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('telegram_id', p_telegram::text),
    raw_user_meta_data = case when p_username is null then raw_user_meta_data
      else coalesce(raw_user_meta_data, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('telegram_username', p_username)
      end
  where id = p_user;

  return 'ok';
end;
$$;

revoke all on function public.telegram_link(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.telegram_link(uuid, bigint, text) to service_role;

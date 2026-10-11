begin;

insert into auth.users (id, email, created_at, raw_app_meta_data, raw_user_meta_data)
values
  ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'telegram-link-main@example.com', now(), '{"roles":["x"]}', '{"display_name":"main"}'),
  ('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'telegram-link-other@example.com', now(), '{}', '{}'),
  ('f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 'tg333@telegram.genshinflex.com', now(), '{}', '{}'),
  ('f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4', 'tg444-123@telegram.genshinflex.com', now(), '{}', '{}');

set local role authenticated;
do $$
begin
  begin
    perform public.telegram_link('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 777, 'first');
    raise exception 'FAIL: authenticated telegram link granted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.telegram_unlink('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1');
    raise exception 'FAIL: authenticated telegram unlink granted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  if public.telegram_link('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 777, 'first') is distinct from 'ok' then
    raise exception 'FAIL: service role telegram link';
  end if;
end;
$$;
reset role;

do $$
declare
  v_main uuid := 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
  v_other uuid := 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
  v_synthetic uuid := 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3';
  v_renamed uuid := 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4';
begin
  if (select raw_app_meta_data->>'telegram_id' from auth.users where id = v_main) is distinct from '777' then
    raise exception 'FAIL: telegram id metadata';
  end if;
  if (select raw_user_meta_data->>'telegram_username' from auth.users where id = v_main) is distinct from 'first' then
    raise exception 'FAIL: telegram username metadata';
  end if;
  if public.telegram_link(v_main, 777, 'second') is distinct from 'ok' then
    raise exception 'FAIL: repeated telegram link';
  end if;
  if (select username from public.telegram_accounts where telegram_id = 777) is distinct from 'second' then
    raise exception 'FAIL: telegram username refresh';
  end if;
  if public.telegram_link(v_other, 777, null) is distinct from 'telegram_taken' then
    raise exception 'FAIL: telegram already owned';
  end if;
  if public.telegram_link(v_main, 999, null) is distinct from 'telegram_already_linked' then
    raise exception 'FAIL: user already linked';
  end if;
  if (select count(*) from public.telegram_accounts where user_id = v_main) is distinct from 1 then
    raise exception 'FAIL: duplicate telegram link';
  end if;
  if public.telegram_link(v_synthetic, 333, null) is distinct from 'ok' then
    raise exception 'FAIL: synthetic telegram link';
  end if;
  if public.telegram_unlink(v_synthetic) is distinct from 'last_method' then
    raise exception 'FAIL: last login method';
  end if;
  if not exists (select 1 from public.telegram_accounts where user_id = v_synthetic) then
    raise exception 'FAIL: last method link removed';
  end if;
  if public.telegram_link(v_renamed, 444, null) is distinct from 'ok' then
    raise exception 'FAIL: renamed synthetic telegram link';
  end if;
  if public.telegram_unlink(v_renamed) is distinct from 'last_method' then
    raise exception 'FAIL: renamed synthetic last method';
  end if;
  if public.telegram_unlink(v_main) is distinct from 'ok' then
    raise exception 'FAIL: telegram unlink';
  end if;
  if public.telegram_unlink(v_main) is distinct from 'ok' then
    raise exception 'FAIL: repeated telegram unlink';
  end if;
  if exists (select 1 from public.telegram_accounts where user_id = v_main)
    or (select raw_app_meta_data ? 'telegram_id' from auth.users where id = v_main) then
    raise exception 'FAIL: telegram link not removed';
  end if;
  if (select raw_app_meta_data->'roles' from auth.users where id = v_main) is distinct from '["x"]'::jsonb then
    raise exception 'FAIL: other metadata removed';
  end if;
end;
$$;

rollback;

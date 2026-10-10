begin;

insert into auth.users (id, email, created_at)
values
  ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'telegram-notify-a@example.com', now()),
  ('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'telegram-notify-b@example.com', now()),
  ('f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 'telegram-notify-c@example.com', now());

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'role', 'authenticated')::text, true);

do $$
begin
  if public.set_notify_setting('telegram', true) is distinct from null then
    raise exception 'FAIL: unlinked telegram enabled';
  end if;
  if public.notify_telegram_status() is distinct from '{"linked": false, "enabled": false}'::jsonb then
    raise exception 'FAIL: unlinked telegram status';
  end if;
  if public.set_notify_setting('telegram', false)->>'telegram' is distinct from 'false' then
    raise exception 'FAIL: unlinked telegram disable';
  end if;
end;
$$;

reset role;
insert into public.telegram_accounts (telegram_id, user_id, username)
values
  (123456789, 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'telegram_notify_a'),
  (987654321, 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 'telegram_notify_c');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'role', 'authenticated')::text, true);

do $$
begin
  if public.set_notify_setting('telegram', true)->>'telegram' is distinct from 'true' then
    raise exception 'FAIL: linked telegram setting';
  end if;
  if public.notify_telegram_status() is distinct from '{"linked": true, "enabled": true}'::jsonb then
    raise exception 'FAIL: linked telegram status';
  end if;
end;
$$;

reset role;
with inserted as (
  insert into public.notifications (recipient_id, actor_id, kind)
  values ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'message')
  returning id
)
select set_config('telegram_notify.test.fresh', id::text, true) from inserted;

insert into public.notifications (recipient_id, actor_id, kind, created_at)
values
  ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'follow', now() - interval '16 minutes'),
  ('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'message', now()),
  ('f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'message', now());

set local role service_role;
do $$
declare
  v_count bigint;
  v_id bigint;
  v_chat bigint;
begin
  select count(*), max(id), max(telegram_id)
  into v_count, v_id, v_chat
  from public.telegram_notifications_claim();
  if v_count is distinct from 1 or v_id is distinct from current_setting('telegram_notify.test.fresh')::bigint
    or v_chat is distinct from 123456789 then
    raise exception 'FAIL: telegram claim selection';
  end if;
  if (select count(*) from public.telegram_notifications_claim()) is distinct from 0 then
    raise exception 'FAIL: telegram claim repeated';
  end if;
  if exists (
    select 1 from public.notifications
    where recipient_id = 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3' and telegram_at is not null
  ) then
    raise exception 'FAIL: linked user without telegram opt-in claimed';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'role', 'authenticated')::text, true);

do $$
begin
  if public.notify_telegram_status() is distinct from '{"linked": false, "enabled": false}'::jsonb then
    raise exception 'FAIL: other user telegram status';
  end if;
  begin
    perform 1 from public.telegram_notifications_claim();
    raise exception 'FAIL: authenticated telegram claim granted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;

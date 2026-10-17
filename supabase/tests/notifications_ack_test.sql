begin;

insert into auth.users (id, email, created_at)
values
  ('77777777-7777-4777-8777-777777777771', 'notify-recipient@example.com', now()),
  ('77777777-7777-4777-8777-777777777772', 'notify-actor@example.com', now());

insert into public.telegram_accounts (user_id, telegram_id)
values ('77777777-7777-4777-8777-777777777771', 777777777771);

update public.profiles
set notify = coalesce(notify, '{}'::jsonb) || '{"telegram": true}'::jsonb
where id = '77777777-7777-4777-8777-777777777771';

-- Чужие уведомления в очереди не должны мешать: транзакция всё равно откатывается
update public.notifications set telegram_at = now() where telegram_at is null;

do $$
declare
  v_id bigint;
  v_n int;
  v_attempt int;
begin
  insert into public.notifications (recipient_id, actor_id, kind)
  values ('77777777-7777-4777-8777-777777777771',
    '77777777-7777-4777-8777-777777777772', 'follow')
  returning id into v_id;

  select count(*) into v_n from public.telegram_notifications_claim(100) c where c.id = v_id;
  if v_n <> 1
    or (select telegram_attempts from public.notifications where id = v_id) <> 1
    or (select telegram_at from public.notifications where id = v_id) is not null then
    raise exception 'FAIL: first claim';
  end if;
  select count(*) into v_n from public.telegram_notifications_claim(100) c where c.id = v_id;
  if v_n <> 0 then
    raise exception 'FAIL: active lease';
  end if;

  update public.notifications set telegram_claimed_at = now() - interval '3 minutes' where id = v_id;
  select count(*) into v_n from public.telegram_notifications_claim(100) c where c.id = v_id;
  if v_n <> 1 or (select telegram_attempts from public.notifications where id = v_id) <> 2 then
    raise exception 'FAIL: expired lease';
  end if;

  perform public.telegram_notifications_ack(array[v_id]);
  update public.notifications set telegram_claimed_at = now() - interval '3 minutes' where id = v_id;
  select count(*) into v_n from public.telegram_notifications_claim(100) c where c.id = v_id;
  if v_n <> 0 or (select telegram_at from public.notifications where id = v_id) is null then
    raise exception 'FAIL: ack';
  end if;

  update public.notifications
  set telegram_at = null, telegram_claimed_at = null, telegram_attempts = 0
  where id = v_id;
  for v_attempt in 1..3 loop
    select count(*) into v_n from public.telegram_notifications_claim(100) c where c.id = v_id;
    if v_n <> 1 then
      raise exception 'FAIL: attempt %', v_attempt;
    end if;
    update public.notifications set telegram_claimed_at = now() - interval '3 minutes' where id = v_id;
  end loop;
  select count(*) into v_n from public.telegram_notifications_claim(100) c where c.id = v_id;
  if v_n <> 0 or (select telegram_attempts from public.notifications where id = v_id) <> 3 then
    raise exception 'FAIL: attempt limit';
  end if;
  raise notice 'notification ack tests passed';
end;
$$;

rollback;

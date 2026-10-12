begin;

insert into auth.users (id, email, created_at)
values
  ('55555555-5555-4555-8555-555555555555', 'reward-one@example.com', now()),
  ('66666666-6666-4666-8666-666666666666', 'reward-two@example.com', now());

update public.profiles set is_public = false
where id = '66666666-6666-4666-8666-666666666666';

set local role anon;

do $$
begin
  if (select count(*) from public.rewards) < 2 then
    raise exception 'FAIL: anon rewards read';
  end if;
  begin
    insert into public.user_rewards (user_id, reward_id)
    values ('55555555-5555-4555-8555-555555555555', 'crimson-ring');
    raise exception 'FAIL: anon reward write granted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555', 'role', 'authenticated')::text, true);

update public.profiles
set custom = '{"frame":"crimson-ring","glow":"crimson-aura"}'::jsonb
where id = '55555555-5555-4555-8555-555555555555';

do $$
begin
  if (select custom->>'frame' from public.profiles where id = auth.uid()) is distinct from 'none'
    or (select custom->>'glow' from public.profiles where id = auth.uid()) is distinct from 'none' then
    raise exception 'FAIL: unowned rewards accepted';
  end if;
end;
$$;

reset role;
insert into public.user_rewards (user_id, reward_id, note)
values
  ('55555555-5555-4555-8555-555555555555', 'crimson-ring', 'Тест'),
  ('55555555-5555-4555-8555-555555555555', 'crimson-aura', 'Тест'),
  ('66666666-6666-4666-8666-666666666666', 'crimson-ring', 'Тест');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555', 'role', 'authenticated')::text, true);

update public.profiles
set custom = '{"frame":"crimson-ring","glow":"crimson-aura"}'::jsonb
where id = '55555555-5555-4555-8555-555555555555';

do $$
begin
  if (select custom->>'frame' from public.profiles where id = auth.uid()) is distinct from 'crimson-ring'
    or (select custom->>'glow' from public.profiles where id = auth.uid()) is distinct from 'crimson-aura' then
    raise exception 'FAIL: owned rewards removed';
  end if;
  if (select count(*) from public.user_rewards where user_id = auth.uid()) <> 2
    or exists (select 1 from public.user_rewards where user_id = '66666666-6666-4666-8666-666666666666') then
    raise exception 'FAIL: reward visibility';
  end if;
end;
$$;

update public.profiles
set custom = '{"frame":"gold"}'::jsonb
where id = '55555555-5555-4555-8555-555555555555';

do $$
begin
  if (select custom->>'frame' from public.profiles where id = auth.uid()) is distinct from 'gold'
    or (select custom ? 'glow' from public.profiles where id = auth.uid()) is distinct from false then
    raise exception 'FAIL: ordinary custom changed';
  end if;
end;
$$;

update public.profiles
set custom = '{"frame":"crimson-ring","glow":"crimson-aura"}'::jsonb
where id = '55555555-5555-4555-8555-555555555555';

reset role;
delete from public.user_rewards
where user_id = '55555555-5555-4555-8555-555555555555' and reward_id = 'crimson-ring';

do $$
begin
  if (select custom->>'frame' from public.profiles where id = '55555555-5555-4555-8555-555555555555') is distinct from 'none'
    or (select custom->>'glow' from public.profiles where id = '55555555-5555-4555-8555-555555555555') is distinct from 'crimson-aura' then
    raise exception 'FAIL: frame revocation';
  end if;
end;
$$;

delete from public.user_rewards
where user_id = '55555555-5555-4555-8555-555555555555' and reward_id = 'crimson-aura';

do $$
begin
  if (select custom->>'glow' from public.profiles where id = '55555555-5555-4555-8555-555555555555') is distinct from 'none' then
    raise exception 'FAIL: glow revocation';
  end if;
end;
$$;

insert into public.user_rewards (user_id, reward_id, note)
values ('55555555-5555-4555-8555-555555555555', 'crimson-aura', 'Тест');

update public.profiles
set custom = '{"frame":"gold","glow":"crimson-aura"}'::jsonb
where id = '55555555-5555-4555-8555-555555555555';

delete from public.rewards
where id = 'crimson-aura';

do $$
begin
  if (select custom->>'frame' from public.profiles where id = '55555555-5555-4555-8555-555555555555') is distinct from 'gold'
    or (select custom->>'glow' from public.profiles where id = '55555555-5555-4555-8555-555555555555') is distinct from 'none' then
    raise exception 'FAIL: cascaded reward revocation';
  end if;
  raise notice 'profile reward tests passed';
end;
$$;

rollback;

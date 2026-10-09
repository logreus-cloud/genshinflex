begin;

insert into auth.users (id, email, created_at)
values
  ('77777777-7777-4777-8777-777777777777', 'social-privacy-a@example.com', now() - interval '30 days'),
  ('88888888-8888-4888-8888-888888888888', 'social-privacy-b@example.com', now() - interval '30 days'),
  ('99999999-9999-4999-8999-999999999999', 'social-privacy-c@example.com', now() - interval '30 days');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated')::text, true);
select public.social_follow('77777777-7777-4777-8777-777777777777');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{}'::text, true);

do $$
begin
  if (select count(*) from public.social_list('77777777-7777-4777-8777-777777777777', 'followers')) is distinct from 0
    or (select followers from public.social_counts('77777777-7777-4777-8777-777777777777')) is distinct from 1
    or (select lists_hidden from public.social_counts('77777777-7777-4777-8777-777777777777')) is distinct from true then
    raise exception 'FAIL: default anon lists';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '99999999-9999-4999-8999-999999999999', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.social_list('77777777-7777-4777-8777-777777777777', 'followers')) is distinct from 0
    or (select followers from public.social_counts('77777777-7777-4777-8777-777777777777')) is distinct from 1
    or (select lists_hidden from public.social_counts('77777777-7777-4777-8777-777777777777')) is distinct from true then
    raise exception 'FAIL: default other user lists';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text, true);

do $$
declare
  v_a uuid := '77777777-7777-4777-8777-777777777777';
begin
  if (select count(*) from public.social_list(v_a, 'followers')) is distinct from 1
    or (select lists_hidden from public.social_counts(v_a)) is distinct from false then
    raise exception 'FAIL: owner lists';
  end if;
  if public.set_profile_privacy('connections', true)->>'connections' is distinct from 'true' then
    raise exception 'FAIL: enable connections';
  end if;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{}'::text, true);

do $$
begin
  if (select count(*) from public.social_list('77777777-7777-4777-8777-777777777777', 'followers')) is distinct from 1
    or (select lists_hidden from public.social_counts('77777777-7777-4777-8777-777777777777')) is distinct from false then
    raise exception 'FAIL: public connections';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text, true);

do $$
declare
  v_a uuid := '77777777-7777-4777-8777-777777777777';
  v_privacy jsonb := (select privacy from public.profiles where id = v_a);
begin
  if public.set_friend_requests('bad') is distinct from null::jsonb
    or (select privacy from public.profiles where id = v_a) is distinct from v_privacy then
    raise exception 'FAIL: invalid request setting';
  end if;
  begin
    update public.profiles
    set privacy = privacy || '{"requests":"bad"}'::jsonb
    where id = v_a;
    raise exception 'FAIL: invalid requests accepted';
  exception when check_violation then null;
  end;
  if (select privacy from public.profiles where id = v_a) is distinct from v_privacy then
    raise exception 'FAIL: invalid requests changed privacy';
  end if;
  if public.set_friend_requests('nobody')->>'requests' is distinct from 'nobody' then
    raise exception 'FAIL: close requests';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated')::text, true);

do $$
declare
  v_a uuid := '77777777-7777-4777-8777-777777777777';
begin
  begin
    perform public.social_friend_request(v_a);
    raise exception 'FAIL: closed requests accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:requests_closed' then raise; end if;
  end;
  if public.social_relation(v_a)->>'can_request' is distinct from 'false' then
    raise exception 'FAIL: closed request relation';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text, true);
select public.social_friend_request('88888888-8888-4888-8888-888888888888');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_friend_request('77777777-7777-4777-8777-777777777777') is distinct from 'friends' then
    raise exception 'FAIL: incoming request acceptance';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text, true);
select public.social_friend_remove('88888888-8888-4888-8888-888888888888');

do $$
begin
  if public.set_friend_requests('followed')->>'requests' is distinct from 'followed' then
    raise exception 'FAIL: followed requests setting';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '99999999-9999-4999-8999-999999999999', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform public.social_friend_request('77777777-7777-4777-8777-777777777777');
    raise exception 'FAIL: unfollowed request accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:requests_closed' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text, true);
select public.social_follow('99999999-9999-4999-8999-999999999999');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '99999999-9999-4999-8999-999999999999', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_friend_request('77777777-7777-4777-8777-777777777777') is distinct from 'outgoing' then
    raise exception 'FAIL: followed request';
  end if;
end;
$$;

select public.social_friend_remove('77777777-7777-4777-8777-777777777777');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text, true);

do $$
begin
  if public.set_friend_requests('everyone')->>'requests' is distinct from 'everyone' then
    raise exception 'FAIL: open requests';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_friend_request('77777777-7777-4777-8777-777777777777') is distinct from 'outgoing' then
    raise exception 'FAIL: everyone request';
  end if;
  raise notice 'social privacy tests passed';
end;
$$;

rollback;

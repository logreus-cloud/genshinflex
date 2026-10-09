begin;

insert into auth.users (id, email, created_at)
values
  ('11111111-1111-4111-8111-111111111111', 'social-a@example.com', now() - interval '30 days'),
  ('22222222-2222-4222-8222-222222222222', 'social-b@example.com', now() - interval '30 days'),
  ('33333333-3333-4333-8333-333333333333', 'social-c@example.com', now() - interval '30 days'),
  ('44444444-4444-4444-8444-444444444444', 'social-private@example.com', now() - interval '30 days'),
  ('55555555-5555-4555-8555-555555555555', 'social-limit@example.com', now() - interval '30 days');

update public.profiles set is_public = false
where id = '44444444-4444-4444-8444-444444444444';

set local role anon;
select set_config('request.jwt.claims', '{}'::text, true);

do $$
begin
  if (select count(*) from public.social_counts('22222222-2222-4222-8222-222222222222')) is distinct from 1
    or (select followers from public.social_counts('22222222-2222-4222-8222-222222222222')) is distinct from 0
    or (select count(*) from public.social_list('22222222-2222-4222-8222-222222222222', 'followers')) is distinct from 0
    or (select count(*) from public.social_counts('44444444-4444-4444-8444-444444444444')) is distinct from 0 then
    raise exception 'FAIL: anon reads';
  end if;
  begin
    perform public.social_follow('22222222-2222-4222-8222-222222222222');
    raise exception 'FAIL: anon write granted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.social_follows;
    raise exception 'FAIL: anon table select granted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
declare
  v_b uuid := '22222222-2222-4222-8222-222222222222';
begin
  perform public.social_follow(v_b);
  perform public.social_follow(v_b);
  if (select count(*) from public.social_counts(v_b)) is distinct from 1
    or (select followers from public.social_counts(v_b)) is distinct from 1 then
    raise exception 'FAIL: duplicate follow';
  end if;
  begin
    perform public.social_follow('11111111-1111-4111-8111-111111111111');
    raise exception 'FAIL: self follow';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:self' then raise; end if;
  end;
  begin
    perform public.social_follow('44444444-4444-4444-8444-444444444444');
    raise exception 'FAIL: private follow';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:not_found' then raise; end if;
  end;
  perform public.social_unfollow(v_b);
  perform public.social_unfollow(v_b);
  if (select count(*) from public.social_counts(v_b)) is distinct from 1
    or (select followers from public.social_counts(v_b)) is distinct from 0 then
    raise exception 'FAIL: unfollow';
  end if;
  perform public.social_follow(v_b);
  if public.social_friend_request(v_b) is distinct from 'outgoing' then
    raise exception 'FAIL: friend request';
  end if;
  if public.social_friend_request(v_b) is distinct from 'outgoing' then
    raise exception 'FAIL: duplicate request';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);

do $$
declare
  v_a uuid := '11111111-1111-4111-8111-111111111111';
begin
  if (select count(*) from public.social_requests('incoming') where user_id = v_a) is distinct from 1
    or public.social_relation(v_a)->>'friend' is distinct from 'incoming' then
    raise exception 'FAIL: incoming request';
  end if;
  perform public.social_friend_respond(v_a, true);
  if public.social_relation(v_a)->>'friend' is distinct from 'friends'
    or (select count(*) from public.social_counts(v_a)) is distinct from 1
    or (select friends from public.social_counts(v_a)) is distinct from 1
    or (select count(*) from public.social_counts('22222222-2222-4222-8222-222222222222')) is distinct from 1
    or (select friends from public.social_counts('22222222-2222-4222-8222-222222222222')) is distinct from 1
    or (select count(*) from public.social_list('22222222-2222-4222-8222-222222222222', 'friends') where user_id = v_a) is distinct from 1 then
    raise exception 'FAIL: accepted friendship';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_relation('22222222-2222-4222-8222-222222222222')->>'friend' is distinct from 'friends'
    or public.social_friend_request('33333333-3333-4333-8333-333333333333') is distinct from 'outgoing' then
    raise exception 'FAIL: friendship state';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_friend_request('11111111-1111-4111-8111-111111111111') is distinct from 'friends' then
    raise exception 'FAIL: crossed request';
  end if;
  perform public.social_friend_remove('11111111-1111-4111-8111-111111111111');
  if public.social_relation('11111111-1111-4111-8111-111111111111')->>'friend' is distinct from 'none' then
    raise exception 'FAIL: friend remove';
  end if;
  if public.social_friend_request('22222222-2222-4222-8222-222222222222') is distinct from 'outgoing' then
    raise exception 'FAIL: decline setup';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);

do $$
begin
  perform public.social_friend_respond('33333333-3333-4333-8333-333333333333', false);
  if public.social_relation('33333333-3333-4333-8333-333333333333')->>'friend' is distinct from 'none' then
    raise exception 'FAIL: declined addressee relation';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_relation('22222222-2222-4222-8222-222222222222')->>'friend' is distinct from 'declined' then
    raise exception 'FAIL: declined requester relation';
  end if;
  begin
    perform public.social_friend_request('22222222-2222-4222-8222-222222222222');
    raise exception 'FAIL: decline cooldown';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:cooldown' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_friend_request('33333333-3333-4333-8333-333333333333') is distinct from 'outgoing' then
    raise exception 'FAIL: reversed declined request';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_relation('22222222-2222-4222-8222-222222222222')->>'friend' is distinct from 'incoming' then
    raise exception 'FAIL: reversed request relation';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);

do $$
begin
  perform public.social_block('11111111-1111-4111-8111-111111111111');
  if (select count(*) from public.social_counts('22222222-2222-4222-8222-222222222222')) is distinct from 1
    or (select followers from public.social_counts('22222222-2222-4222-8222-222222222222')) is distinct from 0
    or public.social_relation('11111111-1111-4111-8111-111111111111')->>'friend' is distinct from 'none'
    or public.social_relation('11111111-1111-4111-8111-111111111111')->>'blocked' is distinct from 'true'
    or (select count(*) from public.social_blocked() where user_id = '11111111-1111-4111-8111-111111111111') is distinct from 1 then
    raise exception 'FAIL: block cleanup';
  end if;
  begin
    perform public.social_follow('11111111-1111-4111-8111-111111111111');
    raise exception 'FAIL: blocked outgoing follow';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:unavailable' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
begin
  if public.social_relation('22222222-2222-4222-8222-222222222222')->>'blocked' is distinct from 'false' then
    raise exception 'FAIL: leaked incoming block';
  end if;
  begin
    perform public.social_follow('22222222-2222-4222-8222-222222222222');
    raise exception 'FAIL: blocked follow';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:unavailable' then raise; end if;
  end;
  begin
    perform public.social_friend_request('22222222-2222-4222-8222-222222222222');
    raise exception 'FAIL: blocked request';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:unavailable' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);
select public.social_unblock('11111111-1111-4111-8111-111111111111');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
select public.social_follow('22222222-2222-4222-8222-222222222222');

reset role;
insert into auth.users (id, email, created_at)
select (lpad(to_hex(n), 8, '0') || '-6666-4666-8666-666666666666')::uuid,
  'social-extra-' || n || '@example.com', now() - interval '30 days'
from generate_series(1, 61) as g(n);
insert into public.social_follows (follower_id, followee_id)
values ('55555555-5555-4555-8555-555555555555', '00000001-6666-4666-8666-666666666666');
insert into public.social_rate_events (user_id, kind)
select '55555555-5555-4555-8555-555555555555'::uuid, 'friend_request'
from generate_series(1, 20);
insert into public.social_rate_events (user_id, kind)
select '55555555-5555-4555-8555-555555555555'::uuid, 'follow'
from generate_series(1, 60);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555', 'role', 'authenticated')::text, true);

do $$
declare
  v_existing uuid := '00000001-6666-4666-8666-666666666666';
  v_new uuid := '0000003d-6666-4666-8666-666666666666';
begin
  perform public.social_follow(v_existing);
  begin
    perform public.social_follow(v_new);
    raise exception 'FAIL: follow rate limit';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:rate_limited' then raise; end if;
  end;
  begin
    perform public.social_friend_request(v_new);
    raise exception 'FAIL: friend rate limit';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:rate_limited' then raise; end if;
  end;
  raise notice 'social tests passed';
end;
$$;

rollback;

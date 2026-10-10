begin;

insert into auth.users (id, email, created_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dm-a@example.com', now() - interval '30 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dm-b@example.com', now() - interval '30 days'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dm-c@example.com', now() - interval '30 days'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dm-d@example.com', now() - interval '30 days'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dm-private@example.com', now() - interval '30 days'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'dm-limit@example.com', now() - interval '30 days');

update public.profiles set is_public = true
where id in (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'ffffffff-ffff-4fff-8fff-ffffffffffff'
);
update public.profiles set is_public = false
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

insert into auth.users (id, email, created_at)
select (lpad(to_hex(n), 8, '0') || '-7777-4777-8777-777777777777')::uuid,
  'dm-extra-' || n || '@example.com', now() - interval '30 days'
from generate_series(1, 21) as g(n);
update public.profiles set is_public = true
where id in (select id from auth.users where email like 'dm-extra-%@example.com');

set local role anon;
select set_config('request.jwt.claims', '{}'::text, true);

do $$
declare
  v_open bigint;
begin
  begin
    v_open := public.dm_open('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'FAIL: anon dm_open granted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.dm_messages;
    raise exception 'FAIL: anon dm_messages select granted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);

do $$
declare
  v_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_conv bigint;
  v_open bigint;
  v_first bigint;
  v_second bigint;
  v_invalid bigint;
  v_privacy jsonb;
begin
  begin
    v_open := public.dm_open(v_a);
    raise exception 'FAIL: self dm_open';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:self' then raise; end if;
  end;
  begin
    v_open := public.dm_open('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    raise exception 'FAIL: private dm_open';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:not_found' then raise; end if;
  end;
  begin
    v_open := public.dm_open('00000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: missing dm_open';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:not_found' then raise; end if;
  end;
  begin
    v_privacy := public.set_message_privacy('nobody');
    raise exception 'FAIL: invalid message privacy';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:invalid' then raise; end if;
  end;
  v_conv := public.dm_open(v_b);
  v_open := public.dm_open(v_b);
  if v_open is distinct from v_conv then
    raise exception 'FAIL: duplicate dm_open';
  end if;
  perform set_config('test.dm_ab', v_conv::text, true);
  select s.id into v_first from public.dm_send(v_conv, '  hello  ') s;
  perform set_config('test.dm_first', v_first::text, true);
  select s.id into v_second from public.dm_send(v_conv, 'second') s;
  if (select count(*) from public.dm_messages(v_conv)) is distinct from 2
    or (select body from public.dm_messages(v_conv) where id = v_first) is distinct from 'hello'
    or (select count(*) from public.dm_messages where conversation_id = v_conv) is distinct from 2 then
    raise exception 'FAIL: dm_send and own read';
  end if;
  begin
    select s.id into v_invalid from public.dm_send(v_conv, '  ') s;
    raise exception 'FAIL: blank dm_send';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:invalid' then raise; end if;
  end;
  begin
    select s.id into v_invalid from public.dm_send(v_conv, repeat('x', 2001)) s;
    raise exception 'FAIL: long dm_send';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:invalid' then raise; end if;
  end;
  v_privacy := public.set_message_privacy('friends');
  if v_privacy->>'messages' is distinct from 'friends'
    or public.dm_can_message(v_a) is distinct from false then
    raise exception 'FAIL: privacy setting';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'role', 'authenticated')::text, true);

do $$
declare
  v_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_conv bigint := current_setting('test.dm_ab')::bigint;
  v_open bigint;
  v_reply bigint;
  v_read bigint;
  v_deleted boolean;
begin
  if public.dm_unread_count() is distinct from 1
    or (select unread from public.dm_conversations() where id = v_conv) is distinct from 2
    or (select last_body from public.dm_conversations() where id = v_conv) is distinct from 'second'
    or (select last_sender_is_me from public.dm_conversations() where id = v_conv) is distinct from false
    or (select other from public.dm_conversations() where id = v_conv) is null
    or (select count(*) from public.notifications
      where kind = 'message' and actor_id = v_a and read_at is null) is distinct from 1 then
    raise exception 'FAIL: inbox and message notification deduplication';
  end if;
  v_open := public.dm_open(v_a);
  if v_open is distinct from v_conv then
    raise exception 'FAIL: existing conversation with closed privacy';
  end if;
  select s.id into v_reply from public.dm_send(v_conv, 'reply') s;
  perform set_config('test.dm_reply', v_reply::text, true);
  v_read := public.dm_mark_read(v_conv);
  if v_read is distinct from v_reply
    or public.dm_unread_count() is distinct from 0
    or (select unread from public.dm_conversations() where id = v_conv) is distinct from 0
    or (select count(*) from public.notifications
      where kind = 'message' and actor_id = v_a and read_at is null) is distinct from 0 then
    raise exception 'FAIL: dm_mark_read';
  end if;
  begin
    v_deleted := public.dm_delete_message(current_setting('test.dm_first')::bigint);
    raise exception 'FAIL: foreign dm_delete_message';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:not_found' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'role', 'authenticated')::text, true);

do $$
declare
  v_conv bigint := current_setting('test.dm_ab')::bigint;
  v_privacy jsonb;
begin
  begin
    perform 1 from public.dm_messages(v_conv);
    raise exception 'FAIL: third party dm_messages RPC';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:not_found' then raise; end if;
  end;
  v_privacy := public.set_message_privacy('followers');
  if (select count(*) from public.dm_messages where conversation_id = v_conv) is distinct from 0
    or v_privacy->>'messages' is distinct from 'followers' then
    raise exception 'FAIL: third party RLS or follower privacy';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'role', 'authenticated')::text, true);
do $$
declare
  v_privacy jsonb;
begin
  v_privacy := public.set_message_privacy('friends');
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);

do $$
declare
  v_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_c uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_d uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_ab bigint := current_setting('test.dm_ab')::bigint;
  v_ac bigint;
  v_first bigint := current_setting('test.dm_first')::bigint;
  v_open bigint;
  v_sent bigint;
  v_deleted boolean;
  v_follow record;
  v_request text;
begin
  if public.dm_unread_count() is distinct from 1
    or (select unread from public.dm_conversations() where id = v_ab) is distinct from 1
    or (select last_body from public.dm_conversations() where id = v_ab) is distinct from 'reply'
    or (select count(*) from public.dm_conversations()) is distinct from 1 then
    raise exception 'FAIL: received reply';
  end if;
  begin
    v_deleted := public.dm_delete_message(current_setting('test.dm_reply')::bigint);
    raise exception 'FAIL: foreign reply deletion';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:not_found' then raise; end if;
  end;
  v_deleted := public.dm_delete_message(v_first);
  if v_deleted is distinct from true
    or (select body from public.dm_messages(v_ab) where id = v_first) is not null
    or (select deleted from public.dm_messages(v_ab) where id = v_first) is distinct from true then
    raise exception 'FAIL: own dm_delete_message';
  end if;
  begin
    v_deleted := public.dm_delete_message(v_first);
    raise exception 'FAIL: repeated dm_delete_message';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:not_found' then raise; end if;
  end;
  if public.dm_can_message(v_c) is distinct from false then
    raise exception 'FAIL: follower privacy button';
  end if;
  begin
    v_open := public.dm_open(v_c);
    raise exception 'FAIL: follower privacy dm_open';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:unavailable' then raise; end if;
  end;
  select public.social_follow(v_c) into v_follow;
  if public.dm_can_message(v_c) is distinct from true then
    raise exception 'FAIL: follower privacy grant';
  end if;
  v_ac := public.dm_open(v_c);
  perform set_config('test.dm_ac', v_ac::text, true);
  select s.id into v_sent from public.dm_send(v_ac, 'to c') s;
  if public.dm_can_message(v_d) is distinct from false then
    raise exception 'FAIL: friend privacy button';
  end if;
  begin
    v_open := public.dm_open(v_d);
    raise exception 'FAIL: friend privacy dm_open';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:unavailable' then raise; end if;
  end;
  v_request := public.social_friend_request(v_d);
  if v_request is distinct from 'outgoing' then
    raise exception 'FAIL: friend request setup';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'role', 'authenticated')::text, true);
do $$
declare
  v_respond record;
begin
  select public.social_friend_respond('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true) into v_respond;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);

do $$
declare
  v_ad bigint;
begin
  v_ad := public.dm_open('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  if public.dm_can_message('dddddddd-dddd-4ddd-8ddd-dddddddddddd') is distinct from true
    or v_ad is null
    or (select count(*) from public.dm_conversations()) is distinct from 2 then
    raise exception 'FAIL: accepted friend privacy or empty conversation';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'role', 'authenticated')::text, true);

do $$
declare
  v_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_ac bigint := current_setting('test.dm_ac')::bigint;
  v_open bigint;
  v_sent bigint;
begin
  v_open := public.dm_open(v_a);
  if v_open is distinct from v_ac then
    raise exception 'FAIL: privacy reply dm_open';
  end if;
  select s.id into v_sent from public.dm_send(v_ac, 'reply to a') s;
end;
$$;

reset role;
-- Equal timestamps exercise the (time, id) cursor.
update public.dm_conversations
set last_message_at = '2026-10-10 00:00:00+00'::timestamptz
where id in (current_setting('test.dm_ab')::bigint, current_setting('test.dm_ac')::bigint);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);

do $$
declare
  v_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_ab bigint := current_setting('test.dm_ab')::bigint;
  v_ac bigint := current_setting('test.dm_ac')::bigint;
  v_read bigint;
  v_block record;
  v_sent bigint;
  v_open bigint;
  v_page_id bigint;
  v_page_at timestamptz;
  v_next_id bigint;
begin
  select id, last_message_at into v_page_id, v_page_at
    from public.dm_conversations(null, null, 1);
  select id into v_next_id
    from public.dm_conversations(v_page_at, v_page_id, 1);
  if v_page_at is null or v_page_id is distinct from greatest(v_ab, v_ac)
    or v_next_id is distinct from least(v_ab, v_ac) then
    raise exception 'FAIL: conversation cursor with equal timestamps';
  end if;
  if public.dm_unread_count() is distinct from 2
    or (select unread from public.dm_conversations() where id = v_ac) is distinct from 1
    or (select last_body from public.dm_conversations() where id = v_ac) is distinct from 'reply to a' then
    raise exception 'FAIL: multiple unread conversations';
  end if;
  v_read := public.dm_mark_read(v_ab);
  if public.dm_unread_count() is distinct from 1
    or (select count(*) from public.notifications
      where kind = 'message' and actor_id = v_b and read_at is null) is distinct from 0 then
    raise exception 'FAIL: selective read';
  end if;
  select public.social_block(v_b) into v_block;
  if public.dm_can_message(v_b) is distinct from false
    or (select can_send from public.dm_conversations() where id = v_ab) is distinct from false then
    raise exception 'FAIL: block button and inbox';
  end if;
  begin
    select s.id into v_sent from public.dm_send(v_ab, 'blocked') s;
    raise exception 'FAIL: blocked dm_send';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:unavailable' then raise; end if;
  end;
  begin
    v_open := public.dm_open(v_b);
    raise exception 'FAIL: blocked dm_open';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:unavailable' then raise; end if;
  end;
  v_read := public.dm_mark_read(v_ac);
  if public.dm_unread_count() is distinct from 0 then
    raise exception 'FAIL: all messages read';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'role', 'authenticated')::text, true);

do $$
declare
  v_deleted boolean;
begin
  v_deleted := public.dm_delete_message(current_setting('test.dm_reply')::bigint);
  if v_deleted is distinct from true then
    raise exception 'FAIL: own reply deletion';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);

do $$
begin
  if (select last_body from public.dm_conversations()
    where id = current_setting('test.dm_ab')::bigint) is not null then
    raise exception 'FAIL: deleted last message snippet';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'role', 'authenticated')::text, true);

do $$
declare
  v_ac bigint := current_setting('test.dm_ac')::bigint;
  v_sent bigint;
begin
  select s.id into v_sent from public.dm_send(v_ac, 'unread after deletion') s;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'role', 'authenticated')::text, true);

do $$
declare
  v_target uuid;
  v_open bigint;
begin
  for n in 1..20 loop
    v_target := (lpad(to_hex(n), 8, '0') || '-7777-4777-8777-777777777777')::uuid;
    v_open := public.dm_open(v_target);
  end loop;
  v_target := '00000015-7777-4777-8777-777777777777';
  begin
    v_open := public.dm_open(v_target);
    raise exception 'FAIL: dm_open rate limit';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:rate_limited' then raise; end if;
  end;
end;
$$;

-- account deletion
reset role;
delete from auth.users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);

do $$
declare
  v_ac bigint := current_setting('test.dm_ac')::bigint;
  v_sent bigint;
begin
  if (select other from public.dm_conversations() where id = v_ac) is not null
    or (select can_send from public.dm_conversations() where id = v_ac) is distinct from false
    or (select sender_id from public.dm_messages(v_ac)
      where body = 'reply to a') is not null
    or (select unread from public.dm_conversations() where id = v_ac) is distinct from 1
    or public.dm_unread_count() is distinct from 1 then
    raise exception 'FAIL: deleted account conversation or unread message';
  end if;
  begin
    select s.id into v_sent from public.dm_send(v_ac, 'after deletion') s;
    raise exception 'FAIL: deleted account dm_send';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:unavailable' then raise; end if;
  end;
  raise notice 'message tests passed';
end;
$$;

rollback;

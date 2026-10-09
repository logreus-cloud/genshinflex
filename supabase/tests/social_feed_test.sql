begin;

insert into auth.users (id, email, created_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'feed-a@example.com', now() - interval '30 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'feed-b@example.com', now() - interval '30 days'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'feed-c@example.com', now() - interval '30 days');

set local role anon;
select set_config('request.jwt.claims', '{}'::text, true);

do $$
begin
  begin
    perform 1 from public.social_feed();
    raise exception 'FAIL: anon feed granted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'role', 'authenticated')::text, true);
select set_config('feed.test.thread',
  public.forum_create_thread('builds', 'Feed B title', 'Feed B topic', 'ru')::text, true);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'role', 'authenticated')::text, true);
select public.forum_create_thread('builds', 'Feed C title', 'Feed C topic', 'ru');

reset role;
update public.forum_posts p
set created_at = now() - interval '2 minutes'
where p.thread_id = current_setting('feed.test.thread')::bigint;
insert into public.forum_posts (thread_id, author_id, body, created_at)
values (current_setting('feed.test.thread')::bigint, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Feed B reply', now() - interval '1 minute');
select set_config('feed.test.topic', min(p.id)::text, true), set_config('feed.test.reply', max(p.id)::text, true)
from public.forum_posts p where p.thread_id = current_setting('feed.test.thread')::bigint;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);
select public.social_follow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

do $$
declare
  v_topic bigint := current_setting('feed.test.topic')::bigint;
  v_reply bigint := current_setting('feed.test.reply')::bigint;
  v_first record;
  v_second record;
begin
  if (select count(*) from public.social_feed()) is distinct from 2
    or (select count(*) from public.social_feed() where thread_title = 'Feed C title') is distinct from 0
    or (select count(*) from public.social_feed() where id = v_topic and is_thread) is distinct from 1
    or (select count(*) from public.social_feed() where id = v_reply and not is_thread) is distinct from 1 then
    raise exception 'FAIL: feed contents';
  end if;
  select * into v_first from public.social_feed(null, null, 1);
  select * into v_second from public.social_feed(v_first.created_at, v_first.id, 1);
  if v_first.id is distinct from v_reply
    or v_second.id is distinct from v_topic
    or v_first.author->>'id' is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    or (select count(*) from public.social_feed(v_second.created_at, v_second.id, 1)) is distinct from 0 then
    raise exception 'FAIL: feed pagination';
  end if;
  perform public.social_block('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if (select count(*) from public.social_feed()) is distinct from 0 then
    raise exception 'FAIL: blocked feed';
  end if;
end;
$$;

reset role;
insert into public.social_follows (follower_id, followee_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from public.social_feed()) is distinct from 0 then
    raise exception 'FAIL: blocked feed after follow';
  end if;
end;
$$;

reset role;
delete from public.social_blocks
where blocker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and blocked_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into public.social_blocks (blocker_id, blocked_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from public.social_feed()) is distinct from 0 then
    raise exception 'FAIL: incoming block';
  end if;
  raise notice 'social feed tests passed';
end;
$$;

rollback;

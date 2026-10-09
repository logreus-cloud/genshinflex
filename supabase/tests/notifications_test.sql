begin;

insert into auth.users (id, email, created_at)
values
  ('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'notifications-a@example.com', now() - interval '30 days'),
  ('e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'notifications-b@example.com', now() - interval '30 days'),
  ('e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3', 'notifications-c@example.com', now() - interval '30 days');

set local role anon;
select set_config('request.jwt.claims', '{}'::text, true);

do $$
begin
  begin
    perform 1 from public.notifications_list();
    raise exception 'FAIL: anon notifications granted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
with inserted as (
  insert into public.forum_threads (category, author_id, title, lang)
  values ('builds', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'Notifications A topic', 'ru')
  returning id
)
select set_config('notifications.test.thread', id::text, true) from inserted;

with inserted as (
  insert into public.forum_posts (thread_id, author_id, body)
  values (
    current_setting('notifications.test.thread')::bigint,
    'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'A topic'
  )
  returning id
)
select set_config('notifications.test.topic', id::text, true) from inserted;

with inserted as (
  insert into public.forum_posts (thread_id, author_id, body, reply_to)
  values (
    current_setting('notifications.test.thread')::bigint,
    'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2',
    'B reply', current_setting('notifications.test.topic')::bigint
  )
  returning id
)
select set_config('notifications.test.b_reply', id::text, true) from inserted;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications_list() where kind = 'reply') is distinct from 1
    or (select count(*) from public.notifications_list()
      where kind = 'reply' and post_id = current_setting('notifications.test.b_reply')::bigint
        and thread_title = 'Notifications A topic' and snippet = 'B reply'
        and actor->>'id' = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2') is distinct from 1 then
    raise exception 'FAIL: thread reply';
  end if;
end;
$$;

select set_config('notifications.test.a_reply_notification', id::text, true)
from public.notifications_list()
where post_id = current_setting('notifications.test.b_reply')::bigint;

reset role;
insert into public.forum_posts (thread_id, author_id, body, reply_to)
values (
  current_setting('notifications.test.thread')::bigint,
  'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
  'A own reply', current_setting('notifications.test.topic')::bigint
);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications_list() where kind = 'reply') is distinct from 1 then
    raise exception 'FAIL: own reply';
  end if;
end;
$$;

reset role;
with inserted as (
  insert into public.forum_posts (thread_id, author_id, body, reply_to)
  values (
    current_setting('notifications.test.thread')::bigint,
    'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3',
    'C replies to B', current_setting('notifications.test.b_reply')::bigint
  )
  returning id
)
select set_config('notifications.test.c_reply', id::text, true) from inserted;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications_list() where kind = 'reply') is distinct from 2
    or (select count(*) from public.notifications_list(null, 1)) is distinct from 1
    or (select count(*) from public.notifications_list()
      where post_id = current_setting('notifications.test.c_reply')::bigint) is distinct from 1 then
    raise exception 'FAIL: thread author notification';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications_list()
    where kind = 'reply' and post_id = current_setting('notifications.test.c_reply')::bigint) is distinct from 1 then
    raise exception 'FAIL: replied-to author notification';
  end if;
  perform public.social_follow('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1');
  perform public.social_unfollow('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1');
  perform public.social_follow('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1');
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications_list()
    where kind = 'follow' and read_at is null
      and actor->>'id' = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2') is distinct from 1 then
    raise exception 'FAIL: follow deduplication';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'role', 'authenticated')::text, true);
select public.social_friend_request('e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications_list()
    where kind = 'friend_request' and read_at is null
      and actor->>'id' = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2') is distinct from 1 then
    raise exception 'FAIL: friend request notification';
  end if;
  perform public.social_friend_respond('e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', true);
  if (select count(*) from public.notifications_list()
    where kind = 'friend_request' and read_at is null) is distinct from 0 then
    raise exception 'FAIL: accepted request cleanup';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications_list()
    where kind = 'friend_accept' and read_at is null
      and actor->>'id' = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3') is distinct from 1 then
    raise exception 'FAIL: friend acceptance notification';
  end if;
end;
$$;

select set_config('notifications.test.b_notification', id::text, true)
from public.notifications_list() where kind = 'friend_accept';

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);

do $$
declare
  v_set jsonb;
  v_invalid jsonb;
begin
  v_set := public.set_notify_setting('reply', false);
  if v_set->>'reply' is distinct from 'false' then
    raise exception 'FAIL: set notification setting';
  end if;
  if public.get_notify_settings()->>'reply' is distinct from 'false' then
    raise exception 'FAIL: get notification settings';
  end if;
  v_invalid := public.set_notify_setting('invalid', true);
  if v_invalid is distinct from null then
    raise exception 'FAIL: invalid notification setting';
  end if;
end;
$$;

reset role;
insert into public.forum_posts (thread_id, author_id, body)
values (
  current_setting('notifications.test.thread')::bigint,
  'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'Muted reply'
);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications_list() where kind = 'reply') is distinct from 2 then
    raise exception 'FAIL: disabled reply';
  end if;
  perform public.set_notify_setting('reply', true);
  perform public.social_block('e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3');
end;
$$;

reset role;
insert into public.forum_posts (thread_id, author_id, body)
values (
  current_setting('notifications.test.thread')::bigint,
  'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3', 'Blocked reply'
);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);

do $$
declare
  v_marked int;
begin
  if (select count(*) from public.notifications_list() where kind = 'reply') is distinct from 2 then
    raise exception 'FAIL: blocked reply';
  end if;
  if public.notifications_unread_count() is distinct from 3 then
    raise exception 'FAIL: unread count';
  end if;
  v_marked := public.notifications_mark_read(array[current_setting('notifications.test.b_notification')::bigint]);
  if v_marked is distinct from 0 then
    raise exception 'FAIL: foreign mark read';
  end if;
  v_marked := public.notifications_mark_read(array[current_setting('notifications.test.a_reply_notification')::bigint]);
  if v_marked is distinct from 1 then
    raise exception 'FAIL: own mark read';
  end if;
  if public.notifications_unread_count() is distinct from 2 then
    raise exception 'FAIL: unread after one';
  end if;
  v_marked := public.notifications_mark_read(null);
  if v_marked is distinct from 2 then
    raise exception 'FAIL: mark all read';
  end if;
  if public.notifications_unread_count() is distinct from 0 then
    raise exception 'FAIL: unread after all';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.notifications
    where recipient_id = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1') is distinct from 0
    or (select count(*) from public.notifications) is distinct from 2 then
    raise exception 'FAIL: notification RLS';
  end if;
  raise notice 'notifications tests passed';
end;
$$;

rollback;

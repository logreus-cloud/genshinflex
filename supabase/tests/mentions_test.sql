begin;

insert into auth.users (id, email, created_at)
values
  ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'mentions-a@example.com', now() - interval '30 days'),
  ('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'mentions-b@example.com', now() - interval '30 days'),
  ('f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 'mentions-c@example.com', now() - interval '30 days'),
  ('f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4', 'mentions-d@example.com', now() - interval '30 days'),
  ('f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5', 'mentions-e@example.com', now() - interval '30 days');

update public.profiles set nickname = 'mentA' where id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
update public.profiles set nickname = 'mentB' where id = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
update public.profiles set nickname = 'mentC' where id = 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3';
update public.profiles set nickname = 'mentD' where id = 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4';
update public.profiles set nickname = 'mentE' where id = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5';

with inserted as (
  insert into public.forum_threads (category, author_id, title, lang)
  values ('builds', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'Mentions A topic', 'ru')
  returning id
)
select set_config('mentions.test.thread', id::text, true) from inserted;

with inserted as (
  insert into public.forum_posts (thread_id, author_id, body)
  values (current_setting('mentions.test.thread')::bigint, 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'A topic')
  returning id
)
select set_config('mentions.test.topic', id::text, true) from inserted;

with inserted as (
  insert into public.forum_posts (thread_id, author_id, body, reply_to)
  values (
    current_setting('mentions.test.thread')::bigint, 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
    'привет @mentC и @MENTC и @mentD', current_setting('mentions.test.topic')::bigint
  )
  returning id
)
select set_config('mentions.test.first', id::text, true) from inserted;

do $$
begin
  if (select count(*) from public.notifications
    where post_id = current_setting('mentions.test.first')::bigint
      and recipient_id = 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3' and kind = 'mention') is distinct from 1
    or (select count(*) from public.notifications
      where post_id = current_setting('mentions.test.first')::bigint
        and recipient_id = 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4' and kind = 'mention') is distinct from 1
    or (select count(*) from public.notifications
      where post_id = current_setting('mentions.test.first')::bigint
        and recipient_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1' and kind = 'reply') is distinct from 1
    or (select count(*) from public.notifications
      where post_id = current_setting('mentions.test.first')::bigint
        and recipient_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1' and kind = 'mention') is distinct from 0 then
    raise exception 'FAIL: repeated and reply mentions';
  end if;
end;
$$;

with inserted as (
  insert into public.forum_posts (thread_id, author_id, body, reply_to)
  values (
    current_setting('mentions.test.thread')::bigint, 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
    '@mentA посмотри', current_setting('mentions.test.topic')::bigint
  )
  returning id
)
select set_config('mentions.test.reply', id::text, true) from inserted;

do $$
begin
  if (select count(*) from public.notifications
    where post_id = current_setting('mentions.test.reply')::bigint
      and recipient_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1' and kind = 'reply') is distinct from 1
    or (select count(*) from public.notifications
      where post_id = current_setting('mentions.test.reply')::bigint
        and recipient_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1' and kind = 'mention') is distinct from 0 then
    raise exception 'FAIL: reply takes precedence';
  end if;
end;
$$;

with inserted as (
  insert into public.forum_posts (thread_id, author_id, body)
  values (current_setting('mentions.test.thread')::bigint, 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', '@mentB x@mentC')
  returning id
)
select set_config('mentions.test.invalid', id::text, true) from inserted;

do $$
begin
  if (select count(*) from public.notifications
    where post_id = current_setting('mentions.test.invalid')::bigint
      and kind = 'mention') is distinct from 0 then
    raise exception 'FAIL: self or email-like mention';
  end if;
end;
$$;

update public.forum_posts
set body = body || ' @mentD @mentE'
where id = current_setting('mentions.test.first')::bigint;
update public.forum_posts
set body = body
where id = current_setting('mentions.test.first')::bigint;

do $$
begin
  if (select count(*) from public.notifications
    where post_id = current_setting('mentions.test.first')::bigint
      and recipient_id = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5' and kind = 'mention') is distinct from 1
    or (select count(*) from public.notifications
      where post_id = current_setting('mentions.test.first')::bigint
        and recipient_id = 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4' and kind = 'mention') is distinct from 1 then
    raise exception 'FAIL: edit adds only new mentions';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 'role', 'authenticated')::text, true);
select public.social_block('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2');
reset role;

with inserted as (
  insert into public.forum_posts (thread_id, author_id, body)
  values (current_setting('mentions.test.thread')::bigint, 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', '@mentC после блокировки')
  returning id
)
select set_config('mentions.test.blocked', id::text, true) from inserted;

do $$
begin
  if (select count(*) from public.notifications
    where post_id = current_setting('mentions.test.blocked')::bigint
      and recipient_id = 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3' and kind = 'mention') is distinct from 0 then
    raise exception 'FAIL: blocked mention';
  end if;
end;
$$;

insert into auth.users (id, email, created_at)
select ('f6f6f6f6-f6f6-4f6f-8f6f-' || lpad(users.number::text, 12, '0'))::uuid,
  'mentions-mx' || lpad(users.number::text, 2, '0') || '@example.com',
  now() - interval '30 days'
from generate_series(1, 12) as users(number);

update public.profiles p
set nickname = 'mx' || lpad(users.number::text, 2, '0')
from generate_series(1, 12) as users(number)
where p.id = ('f6f6f6f6-f6f6-4f6f-8f6f-' || lpad(users.number::text, 12, '0'))::uuid;

with inserted as (
  insert into public.forum_posts (thread_id, author_id, body)
  select current_setting('mentions.test.thread')::bigint, 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
    string_agg('@mx' || lpad(nicks.number::text, 2, '0'), ' ' order by nicks.number)
  from generate_series(1, 12) as nicks(number)
  returning id
)
select set_config('mentions.test.limit', id::text, true) from inserted;

do $$
begin
  if (select count(*) from public.notifications
    where post_id = current_setting('mentions.test.limit')::bigint
      and kind = 'mention') is distinct from 10
    or (select count(*) from public.notifications n
      join public.profiles p on p.id = n.recipient_id
      where n.post_id = current_setting('mentions.test.limit')::bigint
        and n.kind = 'mention'
        and p.nickname::text in (
          select 'mx' || lpad(number::text, 2, '0')
          from generate_series(1, 10) as expected(number)
        )) is distinct from 10 then
    raise exception 'FAIL: first ten mentions';
  end if;
  raise notice 'mentions tests passed';
end;
$$;

rollback;

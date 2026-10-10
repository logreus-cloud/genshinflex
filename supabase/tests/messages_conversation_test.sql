begin;

insert into auth.users (id, email, created_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dm-thread-a@example.com', now() - interval '30 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dm-thread-b@example.com', now() - interval '30 days'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dm-thread-c@example.com', now() - interval '30 days');

update public.profiles set is_public = true
where id in (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);

select set_config('test.dm_conversation',
  public.dm_open('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text, true);

do $$
declare
  v_conv bigint := current_setting('test.dm_conversation')::bigint;
begin
  if (select count(*) from public.dm_conversation(v_conv)) is distinct from 1
    or (select other->>'id' from public.dm_conversation(v_conv)) is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    or (select last_body from public.dm_conversation(v_conv)) is not null
    or (select last_sender_is_me from public.dm_conversation(v_conv)) is distinct from false
    or (select can_send from public.dm_conversation(v_conv)) is distinct from true then
    raise exception 'FAIL: empty conversation';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform 1 from public.dm_conversation(current_setting('test.dm_conversation')::bigint);
    raise exception 'FAIL: third party dm_conversation';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'dm:not_found' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'role', 'authenticated')::text, true);

select * from public.dm_send(current_setting('test.dm_conversation')::bigint, 'reply');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'role', 'authenticated')::text, true);

do $$
begin
  if (select unread from public.dm_conversation(current_setting('test.dm_conversation')::bigint)) is distinct from 1
    or (select last_body from public.dm_conversation(current_setting('test.dm_conversation')::bigint)) is distinct from 'reply' then
    raise exception 'FAIL: conversation after reply';
  end if;
end;
$$;

rollback;

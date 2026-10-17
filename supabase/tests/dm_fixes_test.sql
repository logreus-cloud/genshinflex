begin;

insert into auth.users (id, email, created_at)
values
  ('66666666-6666-4666-8666-666666666661', 'dm-fix-a@example.com', now() - interval '30 days'),
  ('66666666-6666-4666-8666-666666666662', 'dm-fix-b@example.com', now() - interval '30 days'),
  ('66666666-6666-4666-8666-666666666663', 'dm-fix-c@example.com', now() - interval '30 days'),
  ('66666666-6666-4666-8666-666666666664', 'dm-fix-mod@example.com', now() - interval '30 days');

update public.profiles set is_public = true
where id = '66666666-6666-4666-8666-666666666662';
update public.profiles
set is_public = false, privacy = privacy || '{"messages":"friends"}'::jsonb
where id = '66666666-6666-4666-8666-666666666661';
update public.profiles set is_public = false
where id = '66666666-6666-4666-8666-666666666663';

insert into public.roles (user_id, role)
values ('66666666-6666-4666-8666-666666666664', 'moderator');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-4666-8666-666666666661', 'role', 'authenticated')::text, true);
select set_config('dm.test.conversation',
  public.dm_open('66666666-6666-4666-8666-666666666662')::text, true);
select set_config('dm.test.deleted', id::text, true)
from public.dm_send(current_setting('dm.test.conversation')::bigint, 'Private hello');
select public.dm_delete_message(current_setting('dm.test.deleted')::bigint);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-4666-8666-666666666662', 'role', 'authenticated')::text, true);

do $$
begin
  if not (select can_send from public.dm_conversation(current_setting('dm.test.conversation')::bigint))
    or not (select can_send from public.dm_conversations() where id = current_setting('dm.test.conversation')::bigint) then
    raise exception 'FAIL: private sender reply flags';
  end if;
end;
$$;

select set_config('dm.test.reply', id::text, true)
from public.dm_send(current_setting('dm.test.conversation')::bigint, 'Public reply');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-4666-8666-666666666661', 'role', 'authenticated')::text, true);
select set_config('dm.test.first', id::text, true)
from public.dm_send(current_setting('dm.test.conversation')::bigint, 'First unread');
select set_config('dm.test.second', id::text, true)
from public.dm_send(current_setting('dm.test.conversation')::bigint, 'Second unread');
select public.dm_report(current_setting('dm.test.reply')::bigint, 'spam');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-4666-8666-666666666662', 'role', 'authenticated')::text, true);

do $$
declare
  v_first bigint;
  v_last bigint;
begin
  v_first := public.dm_mark_read(current_setting('dm.test.conversation')::bigint,
    current_setting('dm.test.first')::bigint);
  if v_first <> current_setting('dm.test.first')::bigint
    or public.dm_unread_count() <> 1
    or (select unread from public.dm_conversation(current_setting('dm.test.conversation')::bigint)) <> 1 then
    raise exception 'FAIL: partial read';
  end if;
  v_last := public.dm_mark_read(current_setting('dm.test.conversation')::bigint,
    current_setting('dm.test.deleted')::bigint);
  if v_last <> v_first or public.dm_unread_count() <> 1 then
    raise exception 'FAIL: read marker decreased';
  end if;
  v_last := public.dm_mark_read(current_setting('dm.test.conversation')::bigint);
  if v_last <> current_setting('dm.test.second')::bigint
    or public.dm_unread_count() <> 0 then
    raise exception 'FAIL: legacy mark read';
  end if;
  begin
    perform public.dm_open('66666666-6666-4666-8666-666666666663');
    raise exception 'FAIL: opened private user';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'dm:not_found' then raise; end if;
  end;
end;
$$;

reset role;
insert into public.social_blocks (blocker_id, blocked_id)
values ('66666666-6666-4666-8666-666666666661', '66666666-6666-4666-8666-666666666662');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-4666-8666-666666666662', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform * from public.dm_send(current_setting('dm.test.conversation')::bigint, 'Blocked reply');
    raise exception 'FAIL: blocked reply';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'dm:unavailable' then raise; end if;
  end;
  if (select can_send from public.dm_conversation(current_setting('dm.test.conversation')::bigint)) then
    raise exception 'FAIL: blocked reply flag';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-4666-8666-666666666664', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform public.dm_moderate_delete(current_setting('dm.test.second')::bigint);
    raise exception 'FAIL: deleted unreported message';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'dm:not_found' then raise; end if;
  end;
end;
$$;

select public.dm_moderate_delete(current_setting('dm.test.reply')::bigint);

do $$
begin
  if not exists (
    select 1 from public.dm_reports_queue(null)
    where message_id = current_setting('dm.test.reply')::bigint
      and status = 'resolved' and message_deleted and body = 'Public reply'
  ) then
    raise exception 'FAIL: reported message moderation';
  end if;
end;
$$;

reset role;
do $$
begin
  if (select body from public.dm_messages
    where id = current_setting('dm.test.second')::bigint) <> 'Second unread' then
    raise exception 'FAIL: unreported message changed';
  end if;
end;
$$;

rollback;

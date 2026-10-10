begin;

reset role;
update public.dm_reports set status = 'dismissed' where status = 'open';

insert into auth.users (id, email, created_at)
values
  ('55555555-5555-4555-8555-555555555551', 'dm-report-a@example.com', now() - interval '30 days'),
  ('55555555-5555-4555-8555-555555555552', 'dm-report-b@example.com', now() - interval '30 days'),
  ('55555555-5555-4555-8555-555555555553', 'dm-report-mod@example.com', now() - interval '30 days'),
  ('55555555-5555-4555-8555-555555555554', 'dm-report-c@example.com', now() - interval '30 days');

update public.profiles set is_public = true
where id in (
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555552'
);

insert into public.roles (user_id, role)
values ('55555555-5555-4555-8555-555555555553', 'moderator');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555551', 'role', 'authenticated')::text, true);
select set_config('dm.test.conversation',
  public.dm_open('55555555-5555-4555-8555-555555555552')::text, true);
select set_config('dm.test.own', id::text, true)
from public.dm_send(current_setting('dm.test.conversation')::bigint, 'A message');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555552', 'role', 'authenticated')::text, true);
select set_config('dm.test.reported', id::text, true)
from public.dm_send(current_setting('dm.test.conversation')::bigint, 'Reported body');
select set_config('dm.test.second', id::text, true)
from public.dm_send(current_setting('dm.test.conversation')::bigint, 'Another body');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555551', 'role', 'authenticated')::text, true);
select public.dm_report(current_setting('dm.test.reported')::bigint, 'spam', 'Review this');

do $$
begin
  begin
    perform public.dm_report(current_setting('dm.test.own')::bigint, 'spam');
    raise exception 'FAIL: own report';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'dm:invalid' then raise; end if;
  end;
  begin
    perform * from public.dm_reports_queue();
    raise exception 'FAIL: user queue access';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'dm:forbidden' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555554', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform public.dm_report(current_setting('dm.test.reported')::bigint, 'spam');
    raise exception 'FAIL: outsider report';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'dm:not_found' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555553', 'role', 'authenticated')::text, true);

do $$
declare
  v_report record;
begin
  select * into v_report from public.dm_reports_queue()
  where message_id = current_setting('dm.test.reported')::bigint;
  if not found or v_report.body <> 'Reported body'
    or v_report.message_deleted
    or not v_report.context @> jsonb_build_array(jsonb_build_object(
      'id', current_setting('dm.test.reported')::bigint,
      'body', 'Reported body', 'reported', true
    )) then
    raise exception 'FAIL: moderator queue and context';
  end if;
  perform set_config('dm.test.report', v_report.id::text, true);
end;
$$;

select public.dm_resolve_report(current_setting('dm.test.report')::bigint, 'resolved');

do $$
begin
  if (select status from public.dm_reports_queue('resolved')
    where id = current_setting('dm.test.report')::bigint) is distinct from 'resolved' then
    raise exception 'FAIL: report resolution';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555551', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform public.dm_report(current_setting('dm.test.reported')::bigint, 'abuse');
    raise exception 'FAIL: report resubmission';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'dm:rate_limited' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555552', 'role', 'authenticated')::text, true);
select public.dm_delete_message(current_setting('dm.test.reported')::bigint);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555553', 'role', 'authenticated')::text, true);

do $$
declare
  v_report record;
begin
  select * into v_report
  from public.dm_reports_queue(null)
  where message_id = current_setting('dm.test.reported')::bigint;
  if not found or v_report.body <> 'Reported body'
    or not v_report.message_deleted
    or not v_report.context @> jsonb_build_array(jsonb_build_object(
      'id', current_setting('dm.test.reported')::bigint,
      'body', null, 'reported', true
    )) then
    raise exception 'FAIL: deleted message snapshot';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555551', 'role', 'authenticated')::text, true);
select public.dm_report(current_setting('dm.test.second')::bigint, 'abuse');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555553', 'role', 'authenticated')::text, true);
select public.dm_moderate_delete(current_setting('dm.test.second')::bigint);

do $$
begin
  if not exists (
    select 1 from public.dm_reports_queue(null)
    where message_id = current_setting('dm.test.second')::bigint
      and status = 'resolved' and message_deleted and body = 'Another body'
  ) then
    raise exception 'FAIL: moderate delete';
  end if;
end;
$$;

select public.forum_ban('55555555-5555-4555-8555-555555555552', null, 'DM spam');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555552', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform * from public.dm_send(current_setting('dm.test.conversation')::bigint, 'Blocked');
    raise exception 'FAIL: banned sender';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'dm:banned' then raise; end if;
  end;
end;
$$;

rollback;

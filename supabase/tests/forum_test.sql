begin;

insert into auth.users (id, email, created_at)
values
  ('11111111-1111-4111-8111-111111111111', 'forum-one@example.com', now() - interval '30 days'),
  ('22222222-2222-4222-8222-222222222222', 'forum-two@example.com', now() - interval '30 days'),
  ('33333333-3333-4333-8333-333333333333', 'forum-mod@example.com', now() - interval '30 days'),
  ('44444444-4444-4444-8444-444444444444', 'forum-new@example.com', now());

insert into public.roles (user_id, role)
values ('33333333-3333-4333-8333-333333333333', 'moderator');

set local role anon;

do $$
begin
  if (select count(*) from public.forum_category_stats()) <> 7
    or (select count(*) from public.forum_threads()) <> 0
    or (select count(*) from public.forum_posts(0)) <> 0 then
    raise exception 'FAIL: anon reads';
  end if;
  begin
    perform public.forum_create_thread('builds', 'Title', 'Body', 'ru');
    raise exception 'FAIL: anon write granted';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.forum_threads;
    raise exception 'FAIL: anon table select granted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
declare
  v_thread bigint;
  v_first bigint;
  v_post bigint;
begin
  begin
    perform public.forum_create_thread('announcements', 'Notice', 'Body', 'ru');
    raise exception 'FAIL: mod-only category';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:forbidden' then raise; end if;
  end;

  v_thread := public.forum_create_thread('builds', '  First thread  ', 'First body', 'ru');
  select first_post_id into v_first from public.forum_thread(v_thread);
  if v_first is null
    or (select title from public.forum_thread(v_thread)) <> 'First thread'
    or (select post_count from public.forum_thread(v_thread)) <> 1 then
    raise exception 'FAIL: thread creation';
  end if;
  perform set_config('forum.test.thread', v_thread::text, true);
  perform set_config('forum.test.first', v_first::text, true);

  begin
    perform public.forum_create_thread('builds', 'Another thread', 'Body', 'ru');
    raise exception 'FAIL: first post bypasses post rate limit';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:rate_limited' then raise; end if;
  end;

  begin
    perform public.forum_create_post(v_thread, 'Too soon');
    raise exception 'FAIL: post rate limit';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:rate_limited' then raise; end if;
  end;
end;
$$;

reset role;
update public.forum_posts set created_at = created_at - interval '1 day'
where id = current_setting('forum.test.first')::bigint;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
declare
  v_thread bigint := current_setting('forum.test.thread')::bigint;
  v_post bigint;
begin
  v_post := public.forum_create_post(v_thread, 'Second body');
  perform set_config('forum.test.second', v_post::text, true);
  if (select post_count from public.forum_thread(v_thread)) <> 2 then
    raise exception 'FAIL: post count';
  end if;
  perform public.forum_set_reaction(v_post, 'heart', true);
  perform public.forum_set_reaction(v_post, 'heart', true);
  if (select reactions->>'heart' from public.forum_posts(v_thread) where id = v_post) <> '1'
    or (select my_reactions from public.forum_posts(v_thread) where id = v_post) <> array['heart']::text[] then
    raise exception 'FAIL: reactions';
  end if;
  begin
    perform public.forum_report(v_post, 'spam');
    raise exception 'FAIL: own report';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:invalid' then raise; end if;
  end;
  begin
    perform * from public.forum_reports_queue();
    raise exception 'FAIL: queue available to user';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:forbidden' then raise; end if;
  end;
end;
$$;

reset role;
update public.forum_posts set created_at = created_at - interval '1 day'
where id = current_setting('forum.test.second')::bigint;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);

do $$
declare
  v_thread bigint := current_setting('forum.test.thread')::bigint;
  v_post bigint;
  v_index int;
begin
  v_post := public.forum_create_post(v_thread, 'Other author');
  perform set_config('forum.test.other', v_post::text, true);
  perform public.forum_report(current_setting('forum.test.second')::bigint, 'spam', 'Review this');
  for v_index in 1..19 loop
    perform public.forum_report(current_setting('forum.test.second')::bigint, 'spam', 'Review this');
  end loop;
  begin
    perform public.forum_report(current_setting('forum.test.second')::bigint, 'spam');
    raise exception 'FAIL: repeated reports bypass rate limit';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:rate_limited' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
declare
  v_post bigint := current_setting('forum.test.other')::bigint;
begin
  begin
    perform public.forum_edit_post(v_post, 'Changed');
    raise exception 'FAIL: edit foreign post';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:forbidden' then raise; end if;
  end;
  begin
    perform public.forum_delete_post(v_post);
    raise exception 'FAIL: delete foreign post';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:forbidden' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text, true);

do $$
declare
  v_thread bigint := current_setting('forum.test.thread')::bigint;
  v_post bigint := current_setting('forum.test.other')::bigint;
begin
  if (select count(*) from public.forum_reports_queue()) <> 1 then
    raise exception 'FAIL: moderator queue';
  end if;
  perform public.forum_delete_post(v_post, 'Spam');
  if (select post_count from public.forum_thread(v_thread)) <> 2 then
    raise exception 'FAIL: delete recount';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
declare
  v_thread bigint := current_setting('forum.test.thread')::bigint;
  v_post bigint := current_setting('forum.test.other')::bigint;
begin
  if not (select deleted from public.forum_posts(v_thread) where id = v_post)
    or (select body from public.forum_posts(v_thread) where id = v_post) is not null
    or (select author from public.forum_posts(v_thread) where id = v_post) is not null then
    raise exception 'FAIL: deleted post visibility';
  end if;
  perform public.forum_delete_post(current_setting('forum.test.first')::bigint);
  if exists (select 1 from public.forum_thread(v_thread))
    or exists (select 1 from public.forum_posts(v_thread)) then
    raise exception 'FAIL: first post hides thread';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text, true);

do $$
declare
  v_thread bigint := current_setting('forum.test.thread')::bigint;
begin
  if not (select deleted from public.forum_thread(v_thread))
    or (select body from public.forum_posts(v_thread)
      where id = current_setting('forum.test.first')::bigint) is null then
    raise exception 'FAIL: moderator hidden thread access';
  end if;
  perform public.forum_restore_post(current_setting('forum.test.first')::bigint);
  perform public.forum_moderate_thread(v_thread, p_locked => true);
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform public.forum_create_post(current_setting('forum.test.thread')::bigint, 'Locked reply');
    raise exception 'FAIL: locked thread accepts user';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:locked' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text, true);

do $$
begin
  perform public.forum_create_post(current_setting('forum.test.thread')::bigint, 'Moderator reply');
  begin
    perform public.forum_ban('33333333-3333-4333-8333-333333333333', null, 'No');
    raise exception 'FAIL: moderator self-ban';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:forbidden' then raise; end if;
  end;
  perform public.forum_ban('11111111-1111-4111-8111-111111111111', now() + interval '1 day', 'Pause');
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform public.forum_create_thread('builds', 'Banned thread', 'Body', 'ru');
    raise exception 'FAIL: ban does not block writing';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:banned' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-8444-444444444444', 'role', 'authenticated')::text, true);
reset role;
update public.forum_posts set created_at = created_at - interval '1 day'
where id = current_setting('forum.test.other')::bigint;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, true);

do $$
declare
  v_thread bigint;
  v_post bigint;
begin
  v_thread := public.forum_create_thread('builds', 'Public profile topic', 'Visible post', 'en');
  select first_post_id into v_post from public.forum_thread(v_thread);
  if not exists (
    select 1 from public.forum_user_posts('user_22222222') where id = v_post
  ) then
    raise exception 'FAIL: public profile posts';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-8444-444444444444', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform public.forum_create_thread('builds', 'New thread', 'Visit https://example.com', 'ru');
    raise exception 'FAIL: new account links';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:links_not_allowed' then raise; end if;
  end;
end;
$$;

reset role;
update public.profiles set is_public = false
where id = '22222222-2222-4222-8222-222222222222';
set local role anon;
select set_config('request.jwt.claims', '{}'::text, true);

do $$
begin
  if exists (
    select 1 from public.forum_user_posts('user_22222222')
  ) then
    raise exception 'FAIL: private profile posts';
  end if;
  if (select count(*) from public.forum_threads()) <> 2
    or (select mine from public.forum_posts(current_setting('forum.test.thread')::bigint)
      where id = current_setting('forum.test.second')::bigint) is distinct from false
    or (select count(*) from public.forum_posts(current_setting('forum.test.thread')::bigint)) <> 4 then
    raise exception 'FAIL: anon forum reading';
  end if;
  raise notice 'forum tests passed';
end;
$$;

rollback;

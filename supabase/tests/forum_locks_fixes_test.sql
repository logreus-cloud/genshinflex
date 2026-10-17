begin;

do $$
declare
  v_i int;
  v_user uuid;
begin
  for v_i in 1..13 loop
    v_user := ('88888888-8888-4888-8888-' || lpad(v_i::text, 12, '0'))::uuid;
    insert into auth.users (id, email, created_at)
    values (v_user, 'forum-fixes-' || v_i || '@example.com', now() - interval '30 days');
    update public.profiles set nickname = 'fixname' || v_i
    where id = v_user;
  end loop;
end;
$$;

insert into public.roles (user_id, role)
values ('88888888-8888-4888-8888-000000000002', 'moderator');
insert into public.user_rewards (user_id, reward_id)
values ('88888888-8888-4888-8888-000000000001', 'crimson-ring');

insert into public.user_titles (user_id, title_id)
values ('88888888-8888-4888-8888-000000000001', 'admin');
update public.user_titles set title_id = 'moderator'
where user_id = '88888888-8888-4888-8888-000000000001' and title_id = 'admin';
do $$
begin
  if not exists (select 1 from public.roles
    where user_id = '88888888-8888-4888-8888-000000000001' and role = 'moderator') then
    raise exception 'FAIL: title update grants role';
  end if;
end;
$$;
update public.user_titles set title_id = 'admin'
where user_id = '88888888-8888-4888-8888-000000000001' and title_id = 'moderator';
do $$
begin
  if exists (select 1 from public.roles
    where user_id = '88888888-8888-4888-8888-000000000001' and role = 'moderator') then
    raise exception 'FAIL: title update revokes role';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-000000000001', 'role', 'authenticated')::text, true);

update public.profiles
set custom = coalesce(custom, '{}'::jsonb) || '{"frame":"crimson-ring"}'::jsonb
where id = auth.uid();
do $$
begin
  if (select custom->>'frame' from public.profiles where id = auth.uid())
    is distinct from 'crimson-ring' then
    raise exception 'FAIL: granted frame';
  end if;
end;
$$;

do $$
declare
  v_thread bigint;
  v_post bigint;
  v_body text := '';
  v_i int;
begin
  v_thread := public.forum_create_thread('builds', 'Forum fixes topic', 'Initial body', 'ru');
  select first_post_id into v_post from public.forum_thread(v_thread);
  perform set_config('forum.fixes.thread', v_thread::text, true);
  perform set_config('forum.fixes.post', v_post::text, true);
  for v_i in 3..13 loop
    v_body := v_body || ' @fixname' || v_i;
  end loop;
  perform public.forum_edit_post(v_post, v_body);
  perform public.forum_edit_post(v_post, ' @fixname13');
  for v_i in 1..60 loop
    perform public.forum_set_reaction(v_post, 'heart', true);
    perform public.forum_set_reaction(v_post, 'heart', false);
  end loop;
  begin
    perform public.forum_set_reaction(v_post, 'heart', true);
    raise exception 'FAIL: reaction limit bypassed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:rate_limited' then raise; end if;
  end;
  perform public.guild_create('forum-fix-guild', 'Forum Fix Guild', 'FXG');
end;
$$;

reset role;
delete from public.user_rewards
where user_id = '88888888-8888-4888-8888-000000000001' and reward_id = 'crimson-ring';
do $$
begin
  if (select custom->>'frame' from public.profiles
    where id = '88888888-8888-4888-8888-000000000001') is distinct from 'none' then
    raise exception 'FAIL: revoked frame remains';
  end if;
  if (select count(*) from public.notifications
    where post_id = current_setting('forum.fixes.post')::bigint and kind = 'mention') <> 10
    or exists (select 1 from public.notifications
      where post_id = current_setting('forum.fixes.post')::bigint and kind = 'mention'
        and recipient_id = '88888888-8888-4888-8888-000000000013') then
    raise exception 'FAIL: lifetime mention limit';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_i int;
begin
  for v_i in 1..20 loop
    perform public.forum_report(current_setting('forum.fixes.post')::bigint, 'spam');
  end loop;
  begin
    perform public.forum_report(current_setting('forum.fixes.post')::bigint, 'spam');
    raise exception 'FAIL: report limit bypassed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:rate_limited' then raise; end if;
  end;
end;
$$;

reset role;
update public.social_rate_events set created_at = now() - interval '61 minutes'
where ctid in (
  select ctid from public.social_rate_events
  where user_id = '88888888-8888-4888-8888-000000000003'
    and kind = 'forum_report'
  order by ctid limit 10
);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  perform public.forum_report(current_setting('forum.fixes.post')::bigint, 'spam');
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  perform public.forum_moderate_thread(current_setting('forum.fixes.thread')::bigint,
    p_locked => true);
  perform public.guild_moderate_delete('forum-fix-guild');
  perform public.forum_edit_thread(current_setting('forum.fixes.thread')::bigint,
    'Moderator edited title');
end;
$$;

reset role;
do $$
begin
  if exists (select 1 from public.guilds where slug = 'forum-fix-guild')
    or (select title from public.forum_threads
      where id = current_setting('forum.fixes.thread')::bigint) <> 'Moderator edited title' then
    raise exception 'FAIL: moderator guild delete or locked title edit';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.forum_edit_thread(current_setting('forum.fixes.thread')::bigint,
      'Author edited title');
    raise exception 'FAIL: locked title edit allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forum:locked' then raise; end if;
  end;
  raise notice 'forum lock fixes tests passed';
end;
$$;

rollback;

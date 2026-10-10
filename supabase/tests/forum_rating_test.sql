begin;
insert into auth.users (id, email, created_at) values
 ('66666666-6666-4666-8666-666666666661','rate-a@example.com', now() - interval '30 days'),
 ('66666666-6666-4666-8666-666666666662','rate-b@example.com', now() - interval '30 days');
update public.profiles set is_public = true where id in ('66666666-6666-4666-8666-666666666661','66666666-6666-4666-8666-666666666662');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','66666666-6666-4666-8666-666666666661','role','authenticated')::text, true);
select set_config('t.thread', public.forum_create_thread('offtopic','Rating test thread','First post body','ru')::text, true);
select public.forum_view(current_setting('t.thread')::bigint);
select set_config('t.first', (select first_post_id from public.forum_thread(current_setting('t.thread')::bigint))::text, true);
select public.forum_set_reaction(current_setting('t.first')::bigint, 'like', true);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','66666666-6666-4666-8666-666666666662','role','authenticated')::text, true);
select public.forum_view(current_setting('t.thread')::bigint);
select public.forum_view(current_setting('t.thread')::bigint);
select public.forum_set_reaction(current_setting('t.first')::bigint, 'like', true);
select public.forum_set_reaction(current_setting('t.first')::bigint, 'fire', true);
select public.forum_create_post(current_setting('t.thread')::bigint, 'Reply from B', null);

do $$
declare s record;
begin
  select * into s from public.forum_user_score('66666666-6666-4666-8666-666666666661');
  -- 2 реакции B (+4), 1 ответ B (+1), 1 просмотр B (0 очков); свои реакция и просмотр не считаются
  if s.points <> 5 or s.reactions <> 2 or s.replies <> 1 or s.views <> 1 or s.place is null then
    raise exception 'FAIL score %', row_to_json(s);
  end if;
  if not exists (
    select 1 from public.forum_leaderboard() l
    where l.author->>'id' = '66666666-6666-4666-8666-666666666661' and l.points = 5
  ) then
    raise exception 'FAIL leaderboard';
  end if;
  begin
    perform public.forum_scores();
    raise exception 'FAIL scores granted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;

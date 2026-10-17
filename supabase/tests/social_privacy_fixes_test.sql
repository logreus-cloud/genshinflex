begin;

insert into auth.users (id, email, created_at)
values
  ('77777777-7777-4777-8777-777777777701', 'social-fixes-a@example.com', now() - interval '30 days'),
  ('77777777-7777-4777-8777-777777777702', 'social-fixes-b@example.com', now() - interval '30 days'),
  ('77777777-7777-4777-8777-777777777703', 'social-fixes-c@example.com', now() - interval '30 days'),
  ('77777777-7777-4777-8777-777777777704', 'social-fixes-d@example.com', now() - interval '30 days');

update public.profiles set is_public = false
where id in ('77777777-7777-4777-8777-777777777701',
  '77777777-7777-4777-8777-777777777702',
  '77777777-7777-4777-8777-777777777704');
insert into public.social_follows (follower_id, followee_id)
values ('77777777-7777-4777-8777-777777777702', '77777777-7777-4777-8777-777777777701'),
  ('77777777-7777-4777-8777-777777777701', '77777777-7777-4777-8777-777777777702');
insert into public.social_friendships (requester_id, addressee_id, status, responded_at)
values ('77777777-7777-4777-8777-777777777701', '77777777-7777-4777-8777-777777777702', 'accepted', now());

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777701', 'role', 'authenticated')::text, true);
do $$
declare
  v_a uuid := '77777777-7777-4777-8777-777777777701';
begin
  if (select count(*) from public.social_list(v_a, 'followers')) is distinct from 1
    or (select count(*) from public.social_list(v_a, 'following')) is distinct from 1
    or (select count(*) from public.social_list(v_a, 'friends')) is distinct from 1
    or (select count(*) from public.social_list(v_a, 'followers')
      where author->>'public' = 'false') is distinct from 1
    or (select followers from public.social_counts(v_a)) is distinct from 1
    or (select following from public.social_counts(v_a)) is distinct from 1
    or (select friends from public.social_counts(v_a)) is distinct from 1
    or (select lists_hidden from public.social_counts(v_a)) is distinct from false then
    raise exception 'FAIL: private owner connections';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777703', 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from public.social_list('77777777-7777-4777-8777-777777777701', 'followers')) is distinct from 0
    or (select count(*) from public.social_counts('77777777-7777-4777-8777-777777777701')) is distinct from 0 then
    raise exception 'FAIL: private owner visible to stranger';
  end if;
  begin
    perform public.social_block('77777777-7777-4777-8777-777777777704');
    raise exception 'FAIL: unseen private block accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from 'social:not_found' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777704', 'role', 'authenticated')::text, true);
select public.social_follow('77777777-7777-4777-8777-777777777703');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777703', 'role', 'authenticated')::text, true);
select public.social_block('77777777-7777-4777-8777-777777777704');
do $$
begin
  if (select count(*) from public.social_blocked()
    where user_id = '77777777-7777-4777-8777-777777777704'
      and author->>'nickname' is not null) is distinct from 1
    or (public.social_relation('77777777-7777-4777-8777-777777777704')->>'followed_by') is distinct from 'false'
    or (public.social_relation('77777777-7777-4777-8777-777777777704')->>'blocked') is distinct from 'true'
  then
    raise exception 'FAIL: traced private block';
  end if;
end;
$$;

reset role;
update public.profiles set is_public = true where id = '77777777-7777-4777-8777-777777777702';
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777703', 'role', 'authenticated')::text, true);
select public.social_block('77777777-7777-4777-8777-777777777702');
do $$
begin
  if (select count(*) from public.social_blocked()
    where user_id = '77777777-7777-4777-8777-777777777702'
      and author->>'nickname' is not null) is distinct from 1 then
    raise exception 'FAIL: public block';
  end if;
end;
$$;
select public.guild_create('privacy-fixes-777', 'Privacy Fixes', 'PFX', null);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777701', 'role', 'authenticated')::text, true);
select public.guild_join('privacy-fixes-777');
do $$
begin
  if (select count(*) from public.guild_member_list('privacy-fixes-777')
    where author->>'id' = '77777777-7777-4777-8777-777777777701'
      and author ? 'nickname') is distinct from 1 then
    raise exception 'FAIL: private member cannot see self';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777702', 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from public.guild_member_list('privacy-fixes-777')) is distinct from 2
    or (select count(*) from public.guild_member_list('privacy-fixes-777')
      where author->>'hidden' = 'true' and not author ? 'nickname') is distinct from 1 then
    raise exception 'FAIL: private guild member exposed';
  end if;
  raise notice 'social privacy fixes tests passed';
end;
$$;

reset role;
update public.profiles set is_public = false
where id = '77777777-7777-4777-8777-777777777703';
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
do $$
begin
  if (select count(*) from public.guild_get('privacy-fixes-777')
    where owner->>'hidden' = 'true' and not owner ? 'nickname') is distinct from 1 then
    raise exception 'FAIL: private guild owner exposed to anon';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777703', 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from public.guild_get('privacy-fixes-777')
    where owner->>'id' = '77777777-7777-4777-8777-777777777703'
      and owner ? 'nickname') is distinct from 1 then
    raise exception 'FAIL: private guild owner cannot see self';
  end if;
end;
$$;

rollback;

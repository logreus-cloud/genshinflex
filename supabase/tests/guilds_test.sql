begin;
insert into auth.users (id, email, created_at) values
 ('77777777-7777-4777-8777-777777777771','guild-a@example.com', now() - interval '30 days'),
 ('77777777-7777-4777-8777-777777777772','guild-b@example.com', now() - interval '30 days'),
 ('77777777-7777-4777-8777-777777777773','guild-c@example.com', now() - interval '30 days');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-4777-8777-777777777771','role','authenticated')::text, true);
select public.guild_create('test-guild', 'Test Guild', 'TG', 'About');

do $$
declare v text;
begin
  begin
    perform public.guild_create('second-guild', 'Second', 'SG');
    raise exception 'FAIL: second guild';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'guild:already_member' then raise; end if;
  end;
  if (select author->'guild'->>'tag' from public.guild_member_list('test-guild')
    where author->>'id' = '77777777-7777-4777-8777-777777777771') is distinct from 'TG' then
    raise exception 'FAIL: author tag';
  end if;
  v := public.guild_mine();
  if v is distinct from 'test-guild' then raise exception 'FAIL: mine'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-4777-8777-777777777772','role','authenticated')::text, true);

do $$
begin
  begin
    perform public.guild_create('other', 'test guild', 'XX');
    raise exception 'FAIL: duplicate name';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'guild:taken' then raise; end if;
  end;
  begin
    perform public.guild_create('bad slug', 'Bad', 'B!');
    raise exception 'FAIL: invalid';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'guild:invalid' then raise; end if;
  end;
end;
$$;
select public.guild_join('test-guild');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-4777-8777-777777777773','role','authenticated')::text, true);
select public.guild_join('test-guild');

do $$
begin
  if (select members from public.guild_get('test-guild')) <> 3
    or (select count(*) from public.guild_member_list('test-guild')) <> 3
    or (select author->>'id' from public.guild_member_list('test-guild') where is_owner) <> '77777777-7777-4777-8777-777777777771' then
    raise exception 'FAIL: members';
  end if;
  begin
    perform public.guild_moderate_delete('test-guild');
    raise exception 'FAIL: moderate by user';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'guild:forbidden' then raise; end if;
  end;
end;
$$;

-- Владелец уходит: гильдия переходит к самому давнему участнику (B)
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-4777-8777-777777777771','role','authenticated')::text, true);
select public.guild_leave();

do $$
begin
  if (select owner->>'id' from public.guild_get('test-guild')) <> '77777777-7777-4777-8777-777777777772'
    or public.guild_mine() is not null then
    raise exception 'FAIL: owner transfer';
  end if;
end;
$$;

-- Все уходят: пустая гильдия удаляется
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-4777-8777-777777777772','role','authenticated')::text, true);
select public.guild_leave();
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-4777-8777-777777777773','role','authenticated')::text, true);
select public.guild_leave();

do $$
begin
  if exists (select 1 from public.guild_get('test-guild')) then
    raise exception 'FAIL: empty guild kept';
  end if;
end;
$$;

rollback;

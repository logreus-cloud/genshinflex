begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('abababab-abab-4bab-8bab-abababababab', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'profile-media-gc@example.test', '', now(), now());

insert into public.profiles (id, nickname, custom)
values ('abababab-abab-4bab-8bab-abababababab', 'profile_media_gc_test', '{}'::jsonb)
on conflict (id) do update set custom = excluded.custom;

insert into storage.objects (bucket_id, name, owner, created_at, updated_at)
values
  ('profile-media', 'abababab-abab-4bab-8bab-abababababab/cover-old', 'abababab-abab-4bab-8bab-abababababab', now() - interval '3 hours', now() - interval '3 hours'),
  ('profile-media', 'abababab-abab-4bab-8bab-abababababab/avatar-used', 'abababab-abab-4bab-8bab-abababababab', now() - interval '3 hours', now() - interval '3 hours'),
  ('profile-media', 'abababab-abab-4bab-8bab-abababababab/background-new', 'abababab-abab-4bab-8bab-abababababab', now(), now());

update public.profiles
set custom = '{"media":{"avatar":"used"}}'::jsonb
where id = 'abababab-abab-4bab-8bab-abababababab';

do $$
declare
  found text[];
begin
  select array_agg(name) into found from public.profile_media_gc_collect(2147483647) as names(name)
  where name like 'abababab-abab-4bab-8bab-%';
  if found is not null then raise exception 'FAIL: first collect returned files'; end if;
  if (select count(*) from public.profile_media_gc where name like 'abababab-abab-4bab-8bab-%') <> 1
    or not exists (select 1 from public.profile_media_gc where name = 'abababab-abab-4bab-8bab-abababababab/cover-old') then
    raise exception 'FAIL: wrong files marked';
  end if;
end;
$$;

update public.profile_media_gc set marked_at = now() - interval '2 hours'
where name like 'abababab-abab-4bab-8bab-%';

do $$
declare
  found text[];
begin
  select array_agg(name) into found from public.profile_media_gc_collect(2147483647) as names(name)
  where name like 'abababab-abab-4bab-8bab-%';
  if found is distinct from array['abababab-abab-4bab-8bab-abababababab/cover-old'] then
    raise exception 'FAIL: old unreferenced file not returned';
  end if;
  if not exists (
    select 1 from public.profile_media_gc
    where name = 'abababab-abab-4bab-8bab-abababababab/cover-old' and reserved_at is not null
  ) then raise exception 'FAIL: file not reserved'; end if;
end;
$$;

do $$
begin
  begin
    update public.profiles
    set custom = '{"media":{"avatar":"used","cover":"old"}}'::jsonb
    where id = 'abababab-abab-4bab-8bab-abababababab';
    raise exception 'FAIL: reserved file accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'profile:media_reserved' then raise; end if;
  end;
  begin
    update public.profiles
    set custom = '{"media":{"avatar":"used","cover":"missing"},"coverType":"upload"}'::jsonb
    where id = 'abababab-abab-4bab-8bab-abababababab';
    raise exception 'FAIL: missing file accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'profile:media_missing' then raise; end if;
  end;
  update public.profiles
  set custom = '{"media":{"avatar":"used","background":"unused"}}'::jsonb
  where id = 'abababab-abab-4bab-8bab-abababababab';
  update public.profiles
  set custom = '{"media":{"avatar":"used"},"v":1}'::jsonb
  where id = 'abababab-abab-4bab-8bab-abababababab';
end;
$$;

update public.profile_media_gc set reserved_at = now() - interval '31 minutes'
where name like 'abababab-abab-4bab-8bab-%';

update public.profiles
set custom = '{"media":{"avatar":"used","cover":"old"}}'::jsonb
where id = 'abababab-abab-4bab-8bab-abababababab';

do $$
declare
  found text[];
begin
  select array_agg(name) into found from public.profile_media_gc_collect(2147483647) as names(name)
  where name like 'abababab-abab-4bab-8bab-%';
  if found is not null then raise exception 'FAIL: referenced file returned'; end if;
  if exists (select 1 from public.profile_media_gc where name = 'abababab-abab-4bab-8bab-abababababab/cover-old') then
    raise exception 'FAIL: referenced file still marked';
  end if;
  if (select count(*) from public.profile_media_gc where name like 'abababab-abab-4bab-8bab-%') <> 0 then
    raise exception 'FAIL: unexpected marks remain';
  end if;
end;
$$;

rollback;

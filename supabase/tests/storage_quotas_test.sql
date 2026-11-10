begin;

insert into auth.users (id, email, created_at, raw_app_meta_data, raw_user_meta_data)
values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'storage-quotas-main@example.com', now(), '{}', '{}'),
  ('a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', 'storage-quotas-other@example.com', now(), '{}', '{}');

insert into public.wishes (user_id, game_uid, id, gacha_type, time, name, item_type, rank_type)
select 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'manual', g::text, '301', '', 'Test', 'Weapon', '3'
from generate_series(1, 200000) g;

do $$
begin
  begin
    insert into public.wishes (user_id, game_uid, id, gacha_type, time, name, item_type, rank_type)
    values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'manual', '200001', '301', '', 'Test', 'Weapon', '3');
    raise exception 'FAIL: wishes quota missing';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'wishes:quota' then raise; end if;
  end;
  if (select count(*) from public.wishes where user_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1') <> 200000 then
    raise exception 'FAIL: wishes count after quota';
  end if;
end;
$$;

insert into storage.objects (bucket_id, name)
values ('profile-media', 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2/storage-quotas-test.png');

set local role authenticated;
do $$
declare
  v_owner uuid := 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  v_other uuid := 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  if public.profile_media_count(v_other) is distinct from 1 then
    raise exception 'FAIL: own profile media count';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  if public.profile_media_count(v_other) is distinct from 0 then
    raise exception 'FAIL: foreign profile media count';
  end if;
end;
$$;
reset role;

rollback;

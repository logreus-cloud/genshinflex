create or replace function public.wishes_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in select distinct user_id from inserted order by user_id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('wishes:' || v_user::text));
    if (select count(*) from public.wishes w where w.user_id = v_user) > 200000 then
      raise exception using errcode = 'P0001', message = 'wishes:quota';
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.wishes_quota() from public, anon, authenticated;

drop trigger if exists wishes_quota on public.wishes;
create trigger wishes_quota
after insert on public.wishes
referencing new table as inserted
for each statement execute function public.wishes_quota();

-- Блокировка на пользователя: параллельные загрузки считают файлы по очереди и не обходят лимит.
-- Расчёт на READ COMMITTED (так работают Storage API и PostgREST): после ожидания блокировки
-- подсчёт видит уже зафиксированные файлы соседней загрузки. То же допущение у квоты wishes выше.
create or replace function public.profile_media_count(p_user uuid)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user is null or p_user is distinct from auth.uid() then
    return 0;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('profile-media:' || p_user::text));
  return (
    select count(*) from storage.objects o
    where o.bucket_id = 'profile-media'
      and (storage.foldername(o.name))[1] = p_user::text
  );
end;
$$;

revoke all on function public.profile_media_count(uuid) from public, anon, authenticated;
grant execute on function public.profile_media_count(uuid) to authenticated;

drop policy if exists "Загрузить медиа своего профиля" on storage.objects;
create policy "Загрузить медиа своего профиля"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not public.account_banned()
  and public.profile_media_count((select auth.uid())) < 40
);

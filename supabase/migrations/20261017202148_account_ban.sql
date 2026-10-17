create function public.account_banned(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Удалённый аккаунт с ещё живым JWT тоже не может писать
  select not exists (
    select 1 from auth.users u
    where u.id = p_user and (u.banned_until is null or u.banned_until <= now())
  );
$$;

create function public.account_banned()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.account_banned(auth.uid());
$$;

revoke all on function public.account_banned(uuid) from public, anon, authenticated;
revoke all on function public.account_banned() from public, anon, authenticated;
grant execute on function public.account_banned() to authenticated;

create or replace function public.forum_write_user()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'forum:auth_required';
  end if;
  if public.account_banned(v_user) then
    raise exception using errcode = 'P0001', message = 'forum:banned';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('forum:' || v_user::text));
  if exists (
    select 1 from public.forum_bans b
    where b.user_id = v_user and (b.until is null or b.until > now())
  ) then
    raise exception using errcode = 'P0001', message = 'forum:banned';
  end if;
  return v_user;
end;
$$;

create or replace function public.social_write_user()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'social:auth_required';
  end if;
  if public.account_banned(v_user) then
    raise exception using errcode = 'P0001', message = 'social:banned';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('social:' || v_user::text));
  return v_user;
end;
$$;

drop policy "Изменить свой профиль" on public.profiles;
create policy "Изменить свой профиль"
on public.profiles for update to authenticated
using (id = (select auth.uid()) and not public.account_banned())
with check (id = (select auth.uid()) and not public.account_banned());

drop policy "Загрузить свой аватар" on storage.objects;
create policy "Загрузить свой аватар"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not public.account_banned()
);

drop policy "Заменить свой аватар" on storage.objects;
create policy "Заменить свой аватар"
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not public.account_banned()
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not public.account_banned()
);

drop policy "Загрузить медиа своего профиля" on storage.objects;
create policy "Загрузить медиа своего профиля"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not public.account_banned()
);

drop policy "Заменить медиа своего профиля" on storage.objects;
create policy "Заменить медиа своего профиля"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not public.account_banned()
)
with check (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not public.account_banned()
);

create function public.title_revoke(p_user uuid, p_title text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_active text;
  v_next text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('titles:' || p_user::text));
  select p.active_title into v_active
  from public.profiles p where p.id = p_user for update;

  delete from public.user_titles t
  where t.user_id = p_user and t.title_id = p_title;
  if not found then
    raise exception using errcode = 'P0001', message = 'title:not_granted';
  end if;

  if v_active = p_title then
    select t.title_id into v_next
    from public.user_titles t
    where t.user_id = p_user
    order by t.granted_at desc, t.title_id desc
    limit 1 for key share;
    -- Внешний ключ уже обнулил active_title при удалении выдачи.
    update public.profiles p
    set active_title = v_next
    where p.id = p_user and p.active_title is null;
  end if;

  return (select p.active_title from public.profiles p where p.id = p_user);
end;
$$;

revoke all on function public.title_revoke(uuid, text) from public, anon, authenticated;
grant execute on function public.title_revoke(uuid, text) to service_role;

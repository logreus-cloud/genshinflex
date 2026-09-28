alter table public.profiles
  add column if not exists custom jsonb,
  add column if not exists custom_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_custom_size') then
    alter table public.profiles add constraint profiles_custom_size check (custom is null or pg_column_size(custom) <= 16384);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_data'::regclass and conname = 'user_data_profile_size') then
    alter table public.user_data add constraint user_data_profile_size check (
      pg_column_size(roster) + pg_column_size(favorites) + pg_column_size(settings) <= 262144
    );
  end if;
end;
$$;

grant select (custom, custom_updated_at) on public.profiles to anon, authenticated;
grant update (custom, custom_updated_at) on public.profiles to authenticated;

create or replace view public.public_profiles
with (security_invoker = true)
as
select nickname, display_name, avatar_path, region, lang, bio, created_at, active_title, custom
from public.profiles
where is_public;

revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Читать медиа профиля') then
    create policy "Читать медиа профиля"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'profile-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Загрузить медиа своего профиля') then
    create policy "Загрузить медиа своего профиля"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'profile-media'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Заменить медиа своего профиля') then
    create policy "Заменить медиа своего профиля"
    on storage.objects for update to authenticated
    using (
      bucket_id = 'profile-media'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
      bucket_id = 'profile-media'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Удалить медиа своего профиля') then
    create policy "Удалить медиа своего профиля"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'profile-media'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
  end if;
end;
$$;

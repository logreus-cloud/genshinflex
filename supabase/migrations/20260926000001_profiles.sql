create extension if not exists citext with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname extensions.citext unique not null,
  display_name text,
  avatar_path text,
  game_uid text check (game_uid ~ '^[0-9]{9,10}$'),
  region text check (region in ('eu', 'na', 'asia', 'tw')),
  lang text not null default 'ru' check (lang in ('ru', 'en', 'es')),
  bio text check (char_length(bio) <= 300),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nickname_format check (nickname::text ~ '^[[:alnum:]_-]{3,24}$')
);

create table public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roster jsonb not null default '{}'::jsonb,
  wishes jsonb not null default '{}'::jsonb,
  favorites jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'moderator', 'author')),
  primary key (user_id, role)
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger user_data_updated_at
before update on public.user_data
for each row execute function public.set_updated_at();

create function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_nickname text := 'user_' || left(replace(new.id::text, '-', ''), 8);
  candidate text := base_nickname;
  suffix integer := 0;
begin
  loop
    begin
      insert into public.profiles (id, nickname, lang)
      values (
        new.id,
        candidate,
        case when new.raw_user_meta_data->>'lang' in ('ru', 'en', 'es')
          then new.raw_user_meta_data->>'lang' else 'ru' end
      );
      return new;
    exception when unique_violation then
      suffix := suffix + 1;
      candidate := base_nickname || '_' || suffix::text;
    end;
  end loop;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile();

alter table public.profiles enable row level security;
alter table public.user_data enable row level security;
alter table public.roles enable row level security;

create policy "Публичные профили и свой профиль"
on public.profiles for select to anon, authenticated
using (is_public or id = (select auth.uid()));

create policy "Изменить свой профиль"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "Удалить свой профиль"
on public.profiles for delete to authenticated
using (id = (select auth.uid()));

create policy "Читать свои данные"
on public.user_data for select to authenticated
using (user_id = (select auth.uid()));

create policy "Создать свои данные"
on public.user_data for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Изменить свои данные"
on public.user_data for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Удалить свои данные"
on public.user_data for delete to authenticated
using (user_id = (select auth.uid()));

create policy "Читать свои роли"
on public.roles for select to authenticated
using (user_id = (select auth.uid()));

-- RLS ограничивает строки; приватные столбцы профиля читает только сервер.
revoke all on public.profiles, public.user_data, public.roles from public, anon, authenticated;
grant select (id, nickname, display_name, avatar_path, region, lang, bio, is_public, created_at)
on public.profiles to anon, authenticated;
grant update (nickname, display_name, avatar_path, game_uid, region, lang, bio, is_public)
on public.profiles to authenticated;
grant delete on public.profiles to authenticated;
-- Сервисная роль (API, модерация) обходит RLS, но права на таблицы нужны явно — в проектах без автоматических grants
grant all on public.profiles, public.user_data, public.roles to service_role;
grant select, insert, update, delete on public.user_data to authenticated;
grant select on public.roles to authenticated;

create view public.public_profiles
with (security_invoker = true)
as
select nickname, display_name, avatar_path, region, lang, bio, created_at
from public.profiles
where is_public;

revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

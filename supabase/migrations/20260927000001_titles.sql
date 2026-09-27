create table public.titles (
  id text primary key check (id ~ '^[a-z0-9-]{2,32}$'),
  name_ru text not null check (char_length(name_ru) between 1 and 32),
  name_en text check (char_length(name_en) <= 32),
  name_es text check (char_length(name_es) <= 32),
  color text not null default '#e3b04b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  description text check (char_length(description) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.user_titles (
  user_id uuid not null references auth.users(id) on delete cascade,
  title_id text not null references public.titles(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  note text check (char_length(note) <= 200),
  granted_at timestamptz not null default now(),
  primary key (user_id, title_id)
);

-- Активный титул: составной внешний ключ на выдачу. Нельзя выбрать невыданный титул,
-- а при отзыве выдачи база атомарно обнулит только active_title (без триггеров и гонок)
alter table public.profiles add column active_title text;
alter table public.profiles
add constraint profiles_active_title_owned
foreign key (id, active_title) references public.user_titles (user_id, title_id)
on delete set null (active_title);
create index user_titles_title_idx on public.user_titles (title_id);

alter table public.titles enable row level security;
alter table public.user_titles enable row level security;

create policy "Читать титулы"
on public.titles for select to anon, authenticated
using (true);

create policy "Читать выданные титулы"
on public.user_titles for select to anon, authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = user_id and p.is_public
  )
);

revoke all on public.titles, public.user_titles from public, anon, authenticated;
grant select on public.titles, public.user_titles to anon, authenticated;
grant all on public.titles, public.user_titles to service_role;
grant select (active_title) on public.profiles to anon, authenticated;

create or replace view public.public_profiles
with (security_invoker = true)
as
select nickname, display_name, avatar_path, region, lang, bio, created_at, active_title
from public.profiles
where is_public;

insert into public.titles (id, name_ru, name_en, name_es, color)
values
  ('admin', 'Админ', 'Admin', 'Admin', '#e3b04b'),
  ('moderator', 'Модератор', 'Moderator', 'Moderador', '#5fb4ff'),
  ('designer', 'Дизайнер', 'Designer', 'Diseñador', '#e87bd8')
on conflict do nothing;

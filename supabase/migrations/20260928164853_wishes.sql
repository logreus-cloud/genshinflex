create table if not exists public.wishes (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_uid text not null check (game_uid ~ '^([0-9]{9,10}|manual)$'),
  id text not null check (char_length(id) between 1 and 32),
  gacha_type text not null check (gacha_type in ('100','200','301','302','400','500')),
  time text not null check (char_length(time) <= 32),
  name text not null check (char_length(name) <= 100),
  item_type text not null check (char_length(item_type) <= 32),
  rank_type text not null check (rank_type in ('3','4','5')),
  item_id text check (item_id is null or char_length(item_id) <= 32),
  created_at timestamptz not null default now(),
  primary key (user_id, game_uid, id)
);

alter table public.wishes enable row level security;

create policy "Читать свои молитвы"
on public.wishes for select to authenticated
using (user_id = (select auth.uid()));

create policy "Добавить свои молитвы"
on public.wishes for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Удалить свои молитвы"
on public.wishes for delete to authenticated
using (user_id = (select auth.uid()));

-- Историю читает только владелец; сервисной роли нужны права для выгрузки аккаунта.
revoke all on public.wishes from public, anon, authenticated;
grant select, insert, delete on public.wishes to authenticated;
grant all on public.wishes to service_role;

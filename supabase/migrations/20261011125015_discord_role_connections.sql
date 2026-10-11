-- Linked Roles Discord: связь аккаунта с Discord и последние отправленные метаданные.
-- token — зашифрованные в API OAuth-токены Discord (AES-GCM), база их не расшифровывает.
create table public.discord_role_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  discord_id text not null unique check (discord_id ~ '^[0-9]{5,25}$'),
  token text not null check (char_length(token) <= 4096),
  metadata jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.discord_role_connections enable row level security;
revoke all on public.discord_role_connections from public, anon, authenticated;
grant select, insert, update, delete on public.discord_role_connections to service_role;

-- Текущие метаданные по Discord ID: аккаунт, ник, очки рейтинга форума, гильдия
create function public.discord_role_state(p_discord_ids text[])
returns table (discord_id text, user_id uuid, nickname text, points int, in_guild boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with linked as (
    select i.provider_id as discord_id, i.user_id
    from auth.identities i
    where i.provider = 'discord' and i.provider_id = any(p_discord_ids)
  ), scores as (
    select s.user_id, s.points
    from public.forum_scores() s
    where s.user_id in (select l.user_id from linked l)
  )
  select l.discord_id, l.user_id, p.nickname::text, coalesce(s.points, 0),
    exists (select 1 from public.guild_members m where m.user_id = l.user_id)
  from linked l
  join public.profiles p on p.id = l.user_id
  left join scores s on s.user_id = l.user_id;
$$;

revoke all on function public.discord_role_state(text[]) from public, anon, authenticated;
grant execute on function public.discord_role_state(text[]) to service_role;

comment on function public.discord_role_state(text[]) is
  'Метаданные Linked Roles для привязанных Discord ID только для сервисного клиента.';

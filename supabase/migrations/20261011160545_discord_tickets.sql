create table public.discord_tickets (
  id bigint generated always as identity primary key,
  discord_id text not null check (discord_id ~ '^[0-9]{5,25}$'),
  thread_id text check (thread_id ~ '^[0-9]{5,25}$'),
  interaction_id text unique,
  status text not null default 'open' check (status in ('open', 'closing', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  close_token uuid
);

-- Обработанные отправки формы: повтор того же interaction не создаёт тикет, даже если первый получил отказ
create table public.discord_ticket_interactions (
  id text primary key check (char_length(id) <= 64),
  created_at timestamptz not null default now()
);
alter table public.discord_ticket_interactions enable row level security;
revoke all on public.discord_ticket_interactions from public, anon, authenticated;
grant select, insert, delete on public.discord_ticket_interactions to service_role;

create index discord_tickets_discord_created_idx
  on public.discord_tickets (discord_id, created_at);

create unique index discord_tickets_one_open_idx
  on public.discord_tickets (discord_id) where status in ('open', 'closing');

alter table public.discord_tickets enable row level security;

revoke all on public.discord_tickets from public, anon, authenticated;
grant select, insert, update, delete on public.discord_tickets to service_role;
grant usage, select on sequence public.discord_tickets_id_seq to service_role;

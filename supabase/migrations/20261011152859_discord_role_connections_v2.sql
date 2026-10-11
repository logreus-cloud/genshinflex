-- Одна запись на Discord ID; удалённый аккаунт оставляет запись (user_id = null), и cron сбрасывает роли.
-- Аренда (lease_owner, lease_until): запись в каждый момент обрабатывает один владелец — cron или OAuth callback.
alter table public.discord_role_connections
  drop constraint discord_role_connections_pkey,
  drop constraint discord_role_connections_discord_id_key,
  drop constraint discord_role_connections_user_id_fkey,
  alter column user_id drop not null,
  add column checked_at timestamptz,
  add column lease_owner uuid,
  add column lease_until timestamptz;

alter table public.discord_role_connections
  add constraint discord_role_connections_pkey primary key (discord_id),
  add constraint discord_role_connections_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

create index discord_role_connections_user_idx on public.discord_role_connections (user_id);
create index discord_role_connections_checked_at_idx on public.discord_role_connections (checked_at asc nulls first);

-- Cron: захватывает одну запись, не проверявшуюся 10 минут и не занятую другим владельцем
create function public.discord_role_claim(p_owner uuid)
returns setof public.discord_role_connections
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
    with picked as (
      select c.discord_id
      from public.discord_role_connections c
      where (c.checked_at is null or c.checked_at < now() - interval '10 minutes')
        and (c.lease_until is null or c.lease_until < now())
      order by c.checked_at asc nulls first
      limit 1
      for update skip locked
    )
    update public.discord_role_connections c
    set lease_owner = p_owner, lease_until = now() + interval '2 minutes'
    from picked
    where c.discord_id = picked.discord_id
    returning c.*;
end;
$$;

-- OAuth callback: создаёт или занимает запись с новыми токенами; false — запись сейчас обрабатывает другой владелец.
-- user_id при конфликте не меняется: его ставит callback после чтения состояния под арендой
create function public.discord_role_lease(p_discord_id text, p_token text, p_owner uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_acquired boolean;
begin
  insert into public.discord_role_connections as c
    (discord_id, user_id, token, metadata, synced_at, checked_at, lease_owner, lease_until)
  values (p_discord_id, null, p_token, null, null, null, p_owner, now() + interval '2 minutes')
  on conflict (discord_id) do update
    set token = excluded.token, metadata = null, synced_at = null, checked_at = null,
      lease_owner = excluded.lease_owner, lease_until = excluded.lease_until
    where c.lease_until is null or c.lease_until < now()
  returning true into v_acquired;
  return coalesce(v_acquired, false);
end;
$$;

revoke all on function public.discord_role_claim(uuid) from public, anon, authenticated;
grant execute on function public.discord_role_claim(uuid) to service_role;
revoke all on function public.discord_role_lease(text, text, uuid) from public, anon, authenticated;
grant execute on function public.discord_role_lease(text, text, uuid) to service_role;

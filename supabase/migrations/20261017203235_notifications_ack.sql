alter table public.notifications
  add column if not exists telegram_claimed_at timestamptz,
  add column if not exists telegram_attempts smallint not null default 0,
  add column if not exists discord_claimed_at timestamptz,
  add column if not exists discord_attempts smallint not null default 0;

drop index if exists public.notifications_telegram_pending_idx;
create index notifications_telegram_pending_idx on public.notifications (created_at)
where telegram_at is null and telegram_attempts < 3;
drop index if exists public.notifications_discord_pending_idx;
create index notifications_discord_pending_idx on public.notifications (created_at)
where discord_at is null and discord_attempts < 3;

create or replace function public.telegram_notifications_claim(p_limit int default 50)
returns table (
  id bigint, telegram_id bigint, kind text, actor jsonb,
  thread_id bigint, thread_title text, post_id bigint, snippet text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select n.id, a.telegram_id
    from public.notifications n
    join public.profiles p on p.id = n.recipient_id
    join public.telegram_accounts a on a.user_id = n.recipient_id
    where n.telegram_at is null
      and n.created_at > now() - interval '15 minutes'
      and (n.telegram_claimed_at is null or n.telegram_claimed_at < now() - interval '2 minutes')
      and n.telegram_attempts < 3
      and p.notify->>'telegram' = 'true'
    order by n.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update of n skip locked
  ), updated as (
    update public.notifications n
    set telegram_claimed_at = now(), telegram_attempts = n.telegram_attempts + 1
    from picked c
    where n.id = c.id
    returning n.id, c.telegram_id, n.kind, n.actor_id, n.thread_id, n.post_id
  )
  select u.id, u.telegram_id, u.kind, public.forum_author_json(u.actor_id),
    u.thread_id, case when t.deleted_at is null then t.title end,
    u.post_id, case when t.deleted_at is null and p.deleted_at is null
      then left(p.body, 160) end
  from updated u
  left join public.forum_threads t on t.id = u.thread_id
  left join public.forum_posts p on p.id = u.post_id
  order by u.id;
end;
$$;

create or replace function public.discord_notifications_claim(p_limit int default 50)
returns table (
  id bigint, discord_id text, kind text, actor jsonb,
  thread_id bigint, thread_title text, post_id bigint, snippet text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select n.id, i.provider_id as discord_id
    from public.notifications n
    join public.profiles p on p.id = n.recipient_id
    join auth.identities i on i.user_id = n.recipient_id and i.provider = 'discord'
    where n.discord_at is null
      and n.created_at > now() - interval '15 minutes'
      and (n.discord_claimed_at is null or n.discord_claimed_at < now() - interval '2 minutes')
      and n.discord_attempts < 3
      and p.notify->>'discord' = 'true'
    order by n.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update of n skip locked
  ), updated as (
    update public.notifications n
    set discord_claimed_at = now(), discord_attempts = n.discord_attempts + 1
    from picked c
    where n.id = c.id
    returning n.id, c.discord_id, n.kind, n.actor_id, n.thread_id, n.post_id
  )
  select u.id, u.discord_id, u.kind, public.forum_author_json(u.actor_id),
    u.thread_id, case when t.deleted_at is null then t.title end,
    u.post_id, case when t.deleted_at is null and p.deleted_at is null
      then left(p.body, 160) end
  from updated u
  left join public.forum_threads t on t.id = u.thread_id
  left join public.forum_posts p on p.id = u.post_id
  order by u.id;
end;
$$;

create function public.telegram_notifications_ack(p_ids bigint[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.notifications n
  set telegram_at = now()
  where n.id = any(p_ids) and n.telegram_at is null;
$$;

create function public.discord_notifications_ack(p_ids bigint[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.notifications n
  set discord_at = now()
  where n.id = any(p_ids) and n.discord_at is null;
$$;

revoke all on function public.telegram_notifications_claim(int) from public, anon, authenticated;
grant execute on function public.telegram_notifications_claim(int) to service_role;
revoke all on function public.discord_notifications_claim(int) from public, anon, authenticated;
grant execute on function public.discord_notifications_claim(int) to service_role;
revoke all on function public.telegram_notifications_ack(bigint[]) from public, anon, authenticated;
grant execute on function public.telegram_notifications_ack(bigint[]) to service_role;
revoke all on function public.discord_notifications_ack(bigint[]) from public, anon, authenticated;
grant execute on function public.discord_notifications_ack(bigint[]) to service_role;

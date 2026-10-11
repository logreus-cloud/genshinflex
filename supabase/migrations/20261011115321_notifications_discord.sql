alter table public.notifications add column discord_at timestamptz;
create index notifications_discord_pending_idx on public.notifications (created_at)
where discord_at is null;

alter table public.profiles drop constraint profiles_notify_shape;
alter table public.profiles add constraint profiles_notify_shape check (
  jsonb_typeof(notify) = 'object'
  and notify - array['reply', 'mention', 'friend_request', 'friend_accept', 'follow', 'message', 'telegram', 'discord'] = '{}'::jsonb
  and coalesce(jsonb_typeof(notify->'reply'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'mention'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'friend_request'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'friend_accept'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'follow'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'message'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'telegram'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'discord'), 'boolean') = 'boolean'
);

create or replace function public.set_notify_setting(p_kind text, p_value boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_notify jsonb;
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'notifications:auth_required';
  end if;
  update public.profiles p
  set notify = p.notify || jsonb_build_object(p_kind, p_value)
  where p.id = v_user
    and p_kind in ('reply', 'mention', 'friend_request', 'friend_accept', 'follow', 'message', 'telegram', 'discord')
    and p_value is not null
    and (p_kind <> 'telegram' or not p_value or exists (
      select 1 from public.telegram_accounts a where a.user_id = v_user
    ))
    and (p_kind <> 'discord' or not p_value or exists (
      select 1 from auth.identities i where i.user_id = v_user and i.provider = 'discord'
    ))
  returning p.notify into v_notify;
  return v_notify;
end;
$$;

create function public.notify_discord_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_linked boolean;
  v_enabled boolean;
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'notifications:auth_required';
  end if;
  select exists (
    select 1 from auth.identities i where i.user_id = v_user and i.provider = 'discord'
  ) into v_linked;
  select p.notify->>'discord' = 'true' into v_enabled
  from public.profiles p where p.id = v_user;
  return jsonb_build_object('linked', v_linked, 'enabled', v_linked and coalesce(v_enabled, false));
end;
$$;

create function public.discord_notifications_claim(p_limit int default 50)
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
      and p.notify->>'discord' = 'true'
    order by n.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update of n skip locked
  ), updated as (
    update public.notifications n
    set discord_at = now()
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

revoke all on function public.set_notify_setting(text, boolean) from public, anon, authenticated;
grant execute on function public.set_notify_setting(text, boolean) to authenticated;
revoke all on function public.notify_discord_status() from public, anon, authenticated;
grant execute on function public.notify_discord_status() to authenticated;
revoke all on function public.discord_notifications_claim(int) from public, anon, authenticated;
grant execute on function public.discord_notifications_claim(int) to service_role;

alter table public.profiles
add column if not exists notify jsonb not null default '{}'::jsonb;

alter table public.profiles add constraint profiles_notify_shape check (
  jsonb_typeof(notify) = 'object'
  and notify - array['reply', 'mention', 'friend_request', 'friend_accept', 'follow', 'message'] = '{}'::jsonb
  and coalesce(jsonb_typeof(notify->'reply'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'mention'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'friend_request'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'friend_accept'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'follow'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(notify->'message'), 'boolean') = 'boolean'
);

create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('reply', 'mention', 'friend_request', 'friend_accept', 'follow', 'message')),
  thread_id bigint references public.forum_threads(id) on delete cascade,
  post_id bigint references public.forum_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_recipient_idx on public.notifications (recipient_id, id desc);
create index notifications_unread_idx on public.notifications (recipient_id)
where read_at is null;

alter table public.notifications enable row level security;

create policy "Читать свои уведомления"
on public.notifications for select to authenticated
using (recipient_id = (select auth.uid()));

revoke all on public.notifications from public, anon, authenticated;
grant all on public.notifications to service_role;
grant all on sequence public.notifications_id_seq to service_role;
grant select on public.notifications to authenticated;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$$;

create function public.notify(
  p_recipient uuid, p_actor uuid, p_kind text,
  p_thread bigint default null, p_post bigint default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then
    return;
  end if;
  if not coalesce((
    select (p.notify->>p_kind)::boolean
    from public.profiles p where p.id = p_recipient
  ), true) then
    return;
  end if;
  if exists (
    select 1 from public.social_blocks b
    where (b.blocker_id = p_recipient and b.blocked_id = p_actor)
      or (b.blocker_id = p_actor and b.blocked_id = p_recipient)
  ) then
    return;
  end if;
  if p_kind in ('follow', 'friend_request') then
    delete from public.notifications n
    where n.recipient_id = p_recipient and n.actor_id = p_actor
      and n.kind = p_kind and n.read_at is null;
  end if;
  insert into public.notifications (recipient_id, actor_id, kind, thread_id, post_id)
  values (p_recipient, p_actor, p_kind, p_thread, p_post);
  delete from public.notifications n
  where n.recipient_id = p_recipient and n.read_at is not null
    and n.created_at < now() - interval '90 days';
end;
$$;

create function public.notifications_forum_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread_author uuid;
  v_reply_author uuid;
begin
  if not exists (
    select 1 from public.forum_posts p
    where p.thread_id = new.thread_id and p.id < new.id
  ) then
    return new;
  end if;
  select t.author_id into v_thread_author
  from public.forum_threads t where t.id = new.thread_id;
  perform public.notify(v_thread_author, new.author_id, 'reply', new.thread_id, new.id);
  if new.reply_to is not null then
    select p.author_id into v_reply_author
    from public.forum_posts p where p.id = new.reply_to;
    if v_reply_author is distinct from v_thread_author then
      perform public.notify(v_reply_author, new.author_id, 'reply', new.thread_id, new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger forum_post_notification
after insert on public.forum_posts
for each row execute function public.notifications_forum_post();

create function public.notifications_social_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify(new.followee_id, new.follower_id, 'follow');
  return new;
end;
$$;

create trigger social_follow_notification
after insert on public.social_follows
for each row execute function public.notifications_social_follow();

create function public.notifications_social_friendship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      perform public.notify(new.addressee_id, new.requester_id, 'friend_request');
    end if;
    return new;
  end if;
  if old.status = 'pending' and (
    new.status <> 'pending'
    or old.requester_id is distinct from new.requester_id
    or old.addressee_id is distinct from new.addressee_id
  ) then
    delete from public.notifications n
    where n.recipient_id = old.addressee_id and n.actor_id = old.requester_id
      and n.kind = 'friend_request' and n.read_at is null;
  end if;
  if new.status = 'pending' and (
    old.status <> 'pending'
    or old.requester_id is distinct from new.requester_id
    or old.addressee_id is distinct from new.addressee_id
  ) then
    perform public.notify(new.addressee_id, new.requester_id, 'friend_request');
  elsif new.status = 'accepted' and old.status = 'pending' then
    perform public.notify(new.requester_id, new.addressee_id, 'friend_accept');
  end if;
  return new;
end;
$$;

create trigger social_friendship_notification
after insert or update on public.social_friendships
for each row execute function public.notifications_social_friendship();

create function public.notifications_social_friendship_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' then
    delete from public.notifications n
    where n.recipient_id = old.addressee_id and n.actor_id = old.requester_id
      and n.kind = 'friend_request' and n.read_at is null;
  end if;
  return old;
end;
$$;

create trigger social_friendship_notification_delete
after delete on public.social_friendships
for each row execute function public.notifications_social_friendship_delete();

create function public.notifications_list(
  p_before_id bigint default null, p_limit int default 30
)
returns table (
  id bigint, kind text, created_at timestamptz, read_at timestamptz,
  actor jsonb, thread_id bigint, thread_title text, post_id bigint, snippet text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'notifications:auth_required';
  end if;
  return query
  select n.id, n.kind, n.created_at, n.read_at,
    public.forum_author_json(n.actor_id), n.thread_id,
    case when t.deleted_at is null then t.title end,
    n.post_id,
    case when t.deleted_at is null and p.deleted_at is null
      then left(p.body, 160) end
  from public.notifications n
  left join public.forum_threads t on t.id = n.thread_id
  left join public.forum_posts p on p.id = n.post_id
  where n.recipient_id = v_user and (p_before_id is null or n.id < p_before_id)
  order by n.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
end;
$$;

create function public.notifications_unread_count()
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'notifications:auth_required';
  end if;
  return (
    select count(*)::int from public.notifications n
    where n.recipient_id = v_user and n.read_at is null
  );
end;
$$;

create function public.notifications_mark_read(p_ids bigint[] default null)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count int;
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'notifications:auth_required';
  end if;
  update public.notifications n set read_at = now()
  where n.recipient_id = v_user and n.read_at is null
    and (p_ids is null or n.id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.get_notify_settings()
returns jsonb
language plpgsql
stable
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
  select p.notify into v_notify from public.profiles p where p.id = v_user;
  return v_notify;
end;
$$;

create function public.set_notify_setting(p_kind text, p_value boolean)
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
    and p_kind in ('reply', 'mention', 'friend_request', 'friend_accept', 'follow', 'message')
    and p_value is not null
  returning p.notify into v_notify;
  return v_notify;
end;
$$;

revoke all on function public.notify(uuid, uuid, text, bigint, bigint)
from public, anon, authenticated;
revoke all on function public.notifications_forum_post()
from public, anon, authenticated;
revoke all on function public.notifications_social_follow()
from public, anon, authenticated;
revoke all on function public.notifications_social_friendship()
from public, anon, authenticated;
revoke all on function public.notifications_social_friendship_delete()
from public, anon, authenticated;
revoke all on function public.notifications_list(bigint, int)
from public, anon, authenticated;
revoke all on function public.notifications_unread_count()
from public, anon, authenticated;
revoke all on function public.notifications_mark_read(bigint[])
from public, anon, authenticated;
revoke all on function public.get_notify_settings()
from public, anon, authenticated;
revoke all on function public.set_notify_setting(text, boolean)
from public, anon, authenticated;

grant execute on function public.notifications_list(bigint, int) to authenticated;
grant execute on function public.notifications_unread_count() to authenticated;
grant execute on function public.notifications_mark_read(bigint[]) to authenticated;
grant execute on function public.get_notify_settings() to authenticated;
grant execute on function public.set_notify_setting(text, boolean) to authenticated;

create table public.dm_conversations (
  id bigint generated always as identity primary key,
  pair_key text not null unique,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table public.dm_members (
  conversation_id bigint not null references public.dm_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_id bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index dm_members_user_idx on public.dm_members (user_id);

create table public.dm_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (deleted_at is not null or char_length(btrim(body)) between 1 and 2000)
);
create index dm_messages_conversation_idx on public.dm_messages (conversation_id, id desc);

alter table public.dm_conversations enable row level security;
alter table public.dm_members enable row level security;
alter table public.dm_messages enable row level security;

revoke all on public.dm_conversations, public.dm_members, public.dm_messages
from public, anon, authenticated;
grant all on public.dm_conversations, public.dm_members, public.dm_messages to service_role;
grant all on sequence public.dm_conversations_id_seq, public.dm_messages_id_seq to service_role;
grant select on public.dm_messages to authenticated;

create function public.dm_is_member(p_conversation bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dm_members m
    where m.conversation_id = p_conversation and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.dm_is_member(bigint) from public, anon, authenticated;
grant execute on function public.dm_is_member(bigint) to authenticated;

create policy "Читать сообщения своего диалога"
on public.dm_messages for select to authenticated
using (public.dm_is_member(conversation_id));

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'dm_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.dm_messages';
  end if;
end;
$$;

alter table public.profiles drop constraint if exists profiles_privacy_shape;
alter table public.profiles add constraint profiles_privacy_shape check (
  jsonb_typeof(privacy) = 'object'
  and privacy - array['uid', 'roster', 'favorites', 'wishes', 'connections', 'requests', 'messages'] = '{}'::jsonb
  and coalesce(jsonb_typeof(privacy->'uid'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(privacy->'roster'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(privacy->'favorites'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(privacy->'wishes'), 'boolean') = 'boolean'
  and coalesce(jsonb_typeof(privacy->'connections'), 'boolean') = 'boolean'
  and (not privacy ? 'requests' or (
    jsonb_typeof(privacy->'requests') = 'string'
    and privacy->>'requests' in ('everyone', 'followed', 'nobody')
  ))
  and (not privacy ? 'messages' or (
    jsonb_typeof(privacy->'messages') = 'string'
    and privacy->>'messages' in ('everyone', 'followers', 'friends')
  ))
);

alter table public.social_rate_events drop constraint social_rate_events_kind_check;
alter table public.social_rate_events add constraint social_rate_events_kind_check
check (kind in ('follow', 'friend_request', 'dm_open', 'dm_message'));

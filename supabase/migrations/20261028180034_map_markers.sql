create table public.map_markers (
  id bigint generated always as identity primary key,
  layer text not null default 'surface' check (layer ~ '^[a-z0-9-]{2,32}$'),
  type text not null check (type in ('waypoint', 'statue', 'domain', 'boss', 'oculus', 'chest', 'specialty', 'puzzle', 'other')),
  x real not null check (abs(x) <= 100000),
  y real not null check (abs(y) <= 100000),
  item text check (item ~ '^[a-z0-9-]{1,64}$'),
  title text check (char_length(btrim(title)) between 1 and 80),
  note text check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('approved', 'pending', 'rejected')),
  author_id uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index map_markers_layer_status_idx on public.map_markers (layer, status);
create index map_markers_author_idx on public.map_markers (author_id);

create table public.map_collected (
  user_id uuid not null references auth.users(id) on delete cascade,
  marker_id bigint not null references public.map_markers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, marker_id)
);

alter table public.map_markers enable row level security;
alter table public.map_collected enable row level security;

revoke all on public.map_markers, public.map_collected from public, anon, authenticated;
revoke all on sequence public.map_markers_id_seq from public, anon, authenticated;
grant select on public.map_markers to anon, authenticated;
grant select, insert, delete on public.map_collected to authenticated;
grant all on public.map_markers, public.map_collected to service_role;
grant all on sequence public.map_markers_id_seq to service_role;

create function public.map_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.forum_is_moderator(auth.uid());
$$;

revoke all on function public.map_is_moderator() from public, anon, authenticated;
grant execute on function public.map_is_moderator() to anon, authenticated;

create policy map_markers_read
on public.map_markers for select to anon, authenticated
using (status = 'approved' or author_id = auth.uid() or public.map_is_moderator());

create policy map_collected_read
on public.map_collected for select to authenticated
using (user_id = auth.uid());

create policy map_collected_insert
on public.map_collected for insert to authenticated
with check (user_id = auth.uid());

create policy map_collected_delete
on public.map_collected for delete to authenticated
using (user_id = auth.uid());

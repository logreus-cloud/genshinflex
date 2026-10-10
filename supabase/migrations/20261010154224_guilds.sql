create table public.guilds (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$'),
  name text not null check (char_length(btrim(name)) between 3 and 40),
  tag text not null check (tag ~ '^[A-Za-zА-Яа-яЁё0-9]{2,5}$'),
  description text check (char_length(description) <= 500),
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index guilds_name_idx on public.guilds (lower(btrim(name)));
create unique index guilds_tag_idx on public.guilds (upper(tag));

-- Одна гильдия на пользователя: user_id — первичный ключ
create table public.guild_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  guild_id bigint not null references public.guilds(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index guild_members_guild_idx on public.guild_members (guild_id, joined_at);

alter table public.guilds enable row level security;
alter table public.guild_members enable row level security;
revoke all on public.guilds, public.guild_members from public, anon, authenticated;
grant all on public.guilds, public.guild_members to service_role;
grant all on sequence public.guilds_id_seq to service_role;

-- Если владелец ушёл или удалил аккаунт: гильдия переходит к самому давнему участнику, пустая удаляется
create function public.guild_settle(p_guild bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  if exists (
    select 1 from public.guilds g
    join public.guild_members m on m.user_id = g.owner_id and m.guild_id = g.id
    where g.id = p_guild
  ) then
    return;
  end if;
  select m.user_id into v_next from public.guild_members m
  where m.guild_id = p_guild order by m.joined_at, m.user_id limit 1;
  if v_next is null then
    delete from public.guilds g where g.id = p_guild;
  else
    update public.guilds g set owner_id = v_next where g.id = p_guild;
  end if;
end;
$$;

create function public.guild_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.guild_settle(old.guild_id);
  return old;
end;
$$;

create trigger guild_members_settle
after delete on public.guild_members
for each row execute function public.guild_members_after_delete();

create function public.guild_user()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'guild:auth_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('guild:' || v_user::text));
  return v_user;
end;
$$;

create function public.guild_create(p_slug text, p_name text, p_tag text, p_description text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.guild_user();
  v_id bigint;
begin
  if exists (select 1 from public.guild_members m where m.user_id = v_user) then
    raise exception using errcode = 'P0001', message = 'guild:already_member';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$'
    or p_name is null or char_length(btrim(p_name)) not between 3 and 40
    or p_tag is null or p_tag !~ '^[A-Za-zА-Яа-яЁё0-9]{2,5}$'
    or char_length(coalesce(p_description, '')) > 500 then
    raise exception using errcode = 'P0001', message = 'guild:invalid';
  end if;
  if exists (
    select 1 from public.guilds g
    where g.slug = p_slug or lower(btrim(g.name)) = lower(btrim(p_name)) or upper(g.tag) = upper(p_tag)
  ) then
    raise exception using errcode = 'P0001', message = 'guild:taken';
  end if;
  insert into public.guilds (slug, name, tag, description, owner_id)
  values (p_slug, btrim(p_name), p_tag, nullif(btrim(coalesce(p_description, '')), ''), v_user)
  returning id into v_id;
  insert into public.guild_members (user_id, guild_id) values (v_user, v_id);
  return p_slug;
end;
$$;

create function public.guild_join(p_slug text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.guild_user();
  v_id bigint;
begin
  if exists (select 1 from public.guild_members m where m.user_id = v_user) then
    raise exception using errcode = 'P0001', message = 'guild:already_member';
  end if;
  select g.id into v_id from public.guilds g where g.slug = p_slug;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'guild:not_found';
  end if;
  insert into public.guild_members (user_id, guild_id) values (v_user, v_id);
end;
$$;

create function public.guild_leave()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.guild_user();
begin
  delete from public.guild_members m where m.user_id = v_user;
  if not found then
    raise exception using errcode = 'P0001', message = 'guild:not_member';
  end if;
end;
$$;

revoke all on function public.guild_settle(bigint) from public, anon, authenticated;
revoke all on function public.guild_members_after_delete() from public, anon, authenticated;
revoke all on function public.guild_user() from public, anon, authenticated;
revoke all on function public.guild_create(text, text, text, text) from public, anon, authenticated;
revoke all on function public.guild_join(text) from public, anon, authenticated;
revoke all on function public.guild_leave() from public, anon, authenticated;
grant execute on function public.guild_create(text, text, text, text) to authenticated;
grant execute on function public.guild_join(text) to authenticated;
grant execute on function public.guild_leave() to authenticated;

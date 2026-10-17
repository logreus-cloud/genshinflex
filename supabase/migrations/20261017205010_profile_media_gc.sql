create table public.profile_media_gc (
  name text primary key,
  marked_at timestamptz not null default now(),
  reserved_at timestamptz
);

alter table public.profile_media_gc enable row level security;
revoke all on public.profile_media_gc from public, anon, authenticated;

create or replace function public.profile_media_gc_collect(p_limit int default 200)
returns setof text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.profile_media_gc g
  where (g.reserved_at is null or g.reserved_at <= now() - interval '30 minutes')
    and (
      not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'profile-media' and o.name = g.name
      ) or exists (
        select 1
        from storage.objects o
        join public.profiles p on p.id::text = (storage.foldername(o.name))[1]
        cross join lateral jsonb_each_text(
          case when jsonb_typeof(p.custom->'media') = 'object' then p.custom->'media' else '{}'::jsonb end
        ) as m(key, value)
        where o.bucket_id = 'profile-media' and o.name = g.name
          and o.name = p.id::text || '/' || m.key || '-' || m.value
      )
    );

  insert into public.profile_media_gc (name)
  select o.name
  from storage.objects o
  where o.bucket_id = 'profile-media'
    and (
      coalesce(o.updated_at, o.created_at) < now() - interval '1 hour'
      or not exists (
        select 1 from public.profiles p
        where p.id::text = (storage.foldername(o.name))[1]
      )
    )
    and not exists (
      select 1
      from public.profiles p
      cross join lateral jsonb_each_text(
        case when jsonb_typeof(p.custom->'media') = 'object' then p.custom->'media' else '{}'::jsonb end
      ) as m(key, value)
      where p.id::text = (storage.foldername(o.name))[1]
        and o.name = p.id::text || '/' || m.key || '-' || m.value
    )
  on conflict (name) do nothing;

  return query
  with candidates as (
    select g.name
    from public.profile_media_gc g
    join storage.objects o on o.bucket_id = 'profile-media' and o.name = g.name
    where g.marked_at < now() - interval '1 hour'
      and (g.reserved_at is null or g.reserved_at <= now() - interval '30 minutes')
      and not exists (
        select 1
        from public.profiles p
        cross join lateral jsonb_each_text(
          case when jsonb_typeof(p.custom->'media') = 'object' then p.custom->'media' else '{}'::jsonb end
        ) as m(key, value)
        where p.id::text = (storage.foldername(o.name))[1]
          and o.name = p.id::text || '/' || m.key || '-' || m.value
      )
    order by g.marked_at, g.name
    limit greatest(coalesce(p_limit, 0), 0)
    for update of g skip locked
  )
  update public.profile_media_gc g
  set reserved_at = now()
  from candidates c
  where g.name = c.name
  returning g.name;
end;
$$;

revoke all on function public.profile_media_gc_collect(int) from public, anon, authenticated;
grant execute on function public.profile_media_gc_collect(int) to service_role;

create or replace function public.profile_media_gc_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_key text;
  v_used boolean;
  v_old jsonb := '{}'::jsonb;
  v_reserved timestamptz;
begin
  if tg_op = 'UPDATE' then
    if jsonb_typeof(old.custom->'media') = 'object' then
      v_old := old.custom->'media';
    end if;
  end if;

  for v_key, v_name in
    select m.key, new.id::text || '/' || m.key || '-' || m.value
    from jsonb_each_text(
      case when jsonb_typeof(new.custom->'media') = 'object' then new.custom->'media' else '{}'::jsonb end
    ) as m(key, value)
    where m.value is not null
      and not exists (
        select 1 from jsonb_each_text(v_old) as previous(key, value)
        where previous.key || '-' || previous.value = m.key || '-' || m.value
      )
  loop
    select g.reserved_at into v_reserved
    from public.profile_media_gc g
    where g.name = v_name
    for update;
    if v_reserved > now() - interval '30 minutes' then
      raise exception using errcode = 'P0001', message = 'profile:media_reserved';
    end if;
    delete from public.profile_media_gc where name = v_name;
    -- Как mediaOf на клиенте: неиспользуемые версии клиент не загружает
    v_used := case v_key
      when 'avatar' then new.custom->'avatar'->>'type' = 'upload'
      when 'cover' then new.custom->>'coverType' = 'upload'
      when 'background' then new.custom->'background'->>'type' = 'upload'
      else false
    end;
    if coalesce(v_used, false) and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'profile-media' and o.name = v_name
      ) then
      raise exception using errcode = 'P0001', message = 'profile:media_missing';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.profile_media_gc_guard() from public, anon, authenticated;

create trigger profile_media_gc_guard
before insert or update of custom on public.profiles
for each row execute function public.profile_media_gc_guard();

create or replace function public.profile_media_gc_done(p_names text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.profile_media_gc where name = any(p_names);
end;
$$;

revoke all on function public.profile_media_gc_done(text[]) from public, anon, authenticated;
grant execute on function public.profile_media_gc_done(text[]) to service_role;

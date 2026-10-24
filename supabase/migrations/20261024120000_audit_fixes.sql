-- Бан аккаунта отключает права модератора во всех проверках через эту функцию.
create or replace function public.forum_is_moderator(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roles r
    where r.user_id = p_user and r.role in ('admin', 'moderator')
      and not public.account_banned(p_user)
  );
$$;

-- Забаненный аккаунт не может менять участие в гильдиях.
create or replace function public.guild_user()
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
  if public.account_banned(v_user) then
    raise exception using errcode = 'P0001', message = 'guild:banned';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('guild:' || v_user::text));
  return v_user;
end;
$$;

-- Гильдия приватного профиля видна только владельцу профиля.
create or replace function public.forum_author_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_user is null then null else (
    select jsonb_build_object(
      'id', p.id,
      'nickname', p.nickname::text,
      'name', coalesce(nullif(btrim(p.custom->>'nick'), ''), p.display_name, p.nickname::text),
      'public', p.is_public,
      'custom', case when p.is_public then p.custom else null end,
      'title', p.active_title,
      'moderator', public.forum_is_moderator(p.id),
      'guild', case when p.is_public or p.id = auth.uid() then (
        select jsonb_build_object('slug', g.slug, 'tag', g.tag, 'name', g.name)
        from public.guild_members m join public.guilds g on g.id = m.guild_id
        where m.user_id = p.id
      ) else null end
    )
    from public.profiles p
    where p.id = p_user
  ) end;
$$;

-- Отправка сообщения не помечает непрочитанные чужие сообщения прочитанными.
create or replace function public.dm_send(p_conversation bigint, p_body text)
returns table (id bigint, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_other uuid;
  v_body text := btrim(p_body);
  v_id bigint;
  v_now timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  v_user := public.social_write_user();
  if exists (
    select 1 from public.forum_bans b
    where b.user_id = v_user and (b.until is null or b.until > now())
  ) then
    raise exception using errcode = 'P0001', message = 'dm:banned';
  end if;
  if not exists (
    select 1 from public.dm_members m
    where m.conversation_id = p_conversation and m.user_id = v_user
  ) then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 2000 then
    raise exception using errcode = 'P0001', message = 'dm:invalid';
  end if;
  select m.user_id into v_other from public.dm_members m
  where m.conversation_id = p_conversation and m.user_id <> v_user;
  if v_other is null then
    raise exception using errcode = 'P0001', message = 'dm:unavailable';
  end if;
  perform public.social_lock_pair(v_user, v_other);
  if not public.dm_reply_allowed(p_conversation, v_user, v_other) then
    raise exception using errcode = 'P0001', message = 'dm:unavailable';
  end if;
  perform public.social_rate_limit(v_user, 'dm_message');
  select greatest(clock_timestamp(), coalesce(c.last_message_at, '-infinity'::timestamptz))
  into v_now from public.dm_conversations c where c.id = p_conversation;
  insert into public.dm_messages (conversation_id, sender_id, body, created_at)
  values (p_conversation, v_user, v_body, v_now)
  returning dm_messages.id into v_id;
  update public.dm_conversations c set last_message_at = v_now
  where c.id = p_conversation;
  update public.dm_members m set last_read_id = v_id
  where m.conversation_id = p_conversation and m.user_id = v_user
    and not exists (
      select 1 from public.dm_messages msg
      where msg.conversation_id = p_conversation
        and msg.id > coalesce(m.last_read_id, 0) and msg.id < v_id
        and msg.sender_id is distinct from v_user
    );
  return query select v_id, v_now;
end;
$$;

-- Сборщик повторно проверяет возраст медиа перед резервированием удаления.
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

  delete from public.profile_media_gc g
  using storage.objects o
  where o.bucket_id = 'profile-media' and o.name = g.name
    and (g.reserved_at is null or g.reserved_at <= now() - interval '30 minutes')
    and coalesce(o.updated_at, o.created_at) >= now() - interval '1 hour'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(o.name))[1]
    );

  return query
  with candidates as (
    select g.name
    from public.profile_media_gc g
    join storage.objects o on o.bucket_id = 'profile-media' and o.name = g.name
    where g.marked_at < now() - interval '1 hour'
      and (g.reserved_at is null or g.reserved_at <= now() - interval '30 minutes')
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

-- Ограничение устаревшей колонки действует только там, где она ещё существует.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_data' and column_name = 'wishes'
  ) and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_data'::regclass and conname = 'user_data_wishes_size'
  ) then
    alter table public.user_data add constraint user_data_wishes_size check (wishes is null or pg_column_size(wishes) <= 1024);
  end if;
end;
$$;

-- Клиент больше не загружает файлы в старый бакет avatars.
drop policy if exists "Загрузить свой аватар" on storage.objects;
drop policy if exists "Заменить свой аватар" on storage.objects;

-- Триггерные функции не должны быть доступны как RPC.
revoke execute on function public.create_profile() from public, anon, authenticated;
revoke execute on function public.check_profile_rewards() from public, anon, authenticated;
revoke execute on function public.clear_revoked_profile_reward() from public, anon, authenticated;

-- notify_discord_status() и notify_telegram_status() возвращают jsonb и вызываются клиентом; их гранты сохранены.

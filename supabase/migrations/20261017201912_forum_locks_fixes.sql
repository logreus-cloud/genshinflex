create or replace function public.check_profile_rewards()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.rewards
    where id = new.custom->>'frame' and kind = 'frame'
  ) then
    perform 1 from public.user_rewards
    where user_id = new.id and reward_id = new.custom->>'frame';
    if not found then
      new.custom := jsonb_set(new.custom, '{frame}', '"none"'::jsonb);
    end if;
  end if;
  if exists (
    select 1 from public.rewards
    where id = new.custom->>'glow' and kind = 'glow'
  ) then
    perform 1 from public.user_rewards
    where user_id = new.id and reward_id = new.custom->>'glow';
    if not found then
      new.custom := jsonb_set(new.custom, '{glow}', '"none"'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.clear_revoked_profile_reward()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = old.user_id for update;
  update public.profiles p
  set custom = p.custom
    || case when p.custom->>'frame' = old.reward_id
      then '{"frame":"none"}'::jsonb else '{}'::jsonb end
    || case when p.custom->>'glow' = old.reward_id
      then '{"glow":"none"}'::jsonb else '{}'::jsonb end
  where p.id = old.user_id
    and not exists (
      select 1 from public.user_rewards r
      where r.user_id = old.user_id and r.reward_id = old.reward_id
    )
    and (p.custom->>'frame' = old.reward_id or p.custom->>'glow' = old.reward_id);
  return old;
end;
$$;

drop trigger if exists clear_revoked_profile_reward on public.user_rewards;
drop trigger if exists clear_revoked_profile_reward_before on public.user_rewards;
create trigger clear_revoked_profile_reward
after delete on public.user_rewards
for each row execute function public.clear_revoked_profile_reward();

create or replace function public.guild_moderate_delete(p_slug text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.forum_is_moderator(auth.uid()) then
    raise exception using errcode = 'P0001', message = 'guild:forbidden';
  end if;
  select g.id into v_id from public.guilds g where g.slug = p_slug;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'guild:not_found';
  end if;
  perform public.guild_lock(v_id);
  delete from public.guilds g where g.id = v_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'guild:not_found';
  end if;
end;
$$;

create or replace function public.sync_moderator_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.title_id = 'moderator' then
    delete from public.roles r
    where r.user_id = old.user_id and r.role = 'moderator'
      and not exists (
        select 1 from public.user_titles t
        where t.user_id = old.user_id and t.title_id = 'moderator'
      );
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.title_id = 'moderator' then
    insert into public.roles (user_id, role)
    values (new.user_id, 'moderator')
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists user_titles_moderator_role on public.user_titles;
create trigger user_titles_moderator_role
after insert or update or delete on public.user_titles
for each row execute function public.sync_moderator_role();

create or replace function public.notifications_forum_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nickname text;
  v_recipient uuid;
  v_sent int;
begin
  if new.deleted_at is not null
    or (tg_op = 'UPDATE' and old.body is not distinct from new.body) then
    return new;
  end if;
  select count(*)::int into v_sent from public.notifications n
  where n.kind = 'mention' and n.post_id = new.id;
  for v_nickname in
    select lower(m.captures[2])
    from regexp_matches(
      new.body, '(^|[^[:alnum:]_@/])@([[:alnum:]_-]{3,24})', 'g'
    ) with ordinality as m(captures, ord)
    group by lower(m.captures[2])
    order by min(m.ord)
    limit 10
  loop
    exit when v_sent >= 10;
    select p.id into v_recipient
    from public.profiles p
    where p.nickname operator(extensions.=) v_nickname::extensions.citext;
    if v_recipient is null or v_recipient is not distinct from new.author_id then
      continue;
    end if;
    if exists (
      select 1 from public.notifications n
      where n.recipient_id = v_recipient and n.post_id = new.id
        and n.kind in ('mention', 'reply')
    ) then
      continue;
    end if;
    perform public.notify(v_recipient, new.author_id, 'mention', new.thread_id, new.id);
    select count(*)::int into v_sent from public.notifications n
    where n.kind = 'mention' and n.post_id = new.id;
  end loop;
  return new;
end;
$$;

create or replace function public.forum_edit_thread(p_thread bigint, p_title text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_thread public.forum_threads%rowtype;
  v_mod boolean := public.forum_is_moderator(v_user);
begin
  select * into v_thread from public.forum_threads t where t.id = p_thread for update;
  if not found or (v_thread.deleted_at is not null and not v_mod) then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_thread.author_id is distinct from v_user and not v_mod then
    raise exception using errcode = 'P0001', message = 'forum:forbidden';
  end if;
  if v_thread.locked and not v_mod then
    raise exception using errcode = 'P0001', message = 'forum:locked';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 120 then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  perform public.forum_check_links(v_user, p_title);
  update public.forum_threads t set title = btrim(p_title) where t.id = p_thread;
end;
$$;

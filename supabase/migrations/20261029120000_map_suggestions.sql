alter table public.social_rate_events
drop constraint if exists social_rate_events_kind_check;
alter table public.social_rate_events
add constraint social_rate_events_kind_check
check (kind in ('follow', 'friend_request', 'dm_open', 'dm_message',
  'forum_reaction', 'forum_report', 'map_suggest'));

revoke select on public.map_markers from anon, authenticated;
grant select (id, layer, type, x, y, item, title, note, status, created_at, updated_at)
on public.map_markers to anon, authenticated;

drop policy map_collected_insert on public.map_collected;
create policy map_collected_insert
on public.map_collected for insert to authenticated
with check (user_id = auth.uid() and exists (
  select 1 from public.map_markers m
  where m.id = marker_id and m.status = 'approved'
));

create function public.map_suggest_marker(
  p_layer text, p_type text, p_x real, p_y real,
  p_title text default null, p_note text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_title text := nullif(btrim(p_title), '');
  v_note text := nullif(btrim(p_note), '');
  v_id bigint;
begin
  if p_layer is null or p_layer !~ '^[a-z0-9-]{2,32}$' or p_layer <> 'surface'
    or p_type is null or p_type not in (
      'waypoint', 'statue', 'domain', 'boss', 'oculus', 'chest',
      'specialty', 'puzzle', 'other'
    )
    or p_x is null or p_x < -9107 or p_x > 6176
    or p_y is null or p_y < -4288 or p_y > 7776
    or (v_title is not null and char_length(v_title) > 80)
    or (v_note is not null and char_length(v_note) > 500)
  then
    raise exception using errcode = 'P0001', message = 'map:invalid';
  end if;

  if not public.forum_is_moderator(v_user) then
    delete from public.social_rate_events e
    where e.user_id = v_user and e.created_at <= now() - interval '1 day';
    if (select count(*) from public.social_rate_events e
      where e.user_id = v_user and e.kind = 'map_suggest'
        and e.created_at > now() - interval '1 hour') >= 30 then
      raise exception using errcode = 'P0001', message = 'map:rate_limited';
    end if;
    if (select count(*) from public.map_markers m
      where m.author_id = v_user and m.status = 'pending') >= 100 then
      raise exception using errcode = 'P0001', message = 'map:too_many_pending';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('map:' || p_layer || ':' || p_type));
  if exists (
    select 1 from public.map_markers m
    where m.layer = p_layer and m.type = p_type
      and m.status in ('approved', 'pending')
      and abs(m.x - p_x) <= 8 and abs(m.y - p_y) <= 8
  ) then
    raise exception using errcode = 'P0001', message = 'map:duplicate';
  end if;

  insert into public.map_markers (layer, type, x, y, title, note, status, author_id)
  values (p_layer, p_type, p_x, p_y, v_title, v_note, 'pending', v_user)
  returning id into v_id;
  if not public.forum_is_moderator(v_user) then
    insert into public.social_rate_events (user_id, kind)
    values (v_user, 'map_suggest');
  end if;
  return v_id;
end;
$$;

create function public.map_withdraw_marker(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
begin
  delete from public.map_markers m
  where m.id = p_id and m.author_id = v_user and m.status = 'pending';
  if not found then
    raise exception using errcode = 'P0001', message = 'map:not_found';
  end if;
end;
$$;

create function public.map_review_marker(
  p_id bigint, p_status text, p_type text default null,
  p_title text default null, p_note text default null,
  p_x real default null, p_y real default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_marker public.map_markers%rowtype;
  v_title text := nullif(btrim(p_title), '');
  v_note text := nullif(btrim(p_note), '');
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'map:forbidden';
  end if;
  if p_status is null or p_status not in ('approved', 'rejected')
    or (p_type is not null and p_type not in (
      'waypoint', 'statue', 'domain', 'boss', 'oculus', 'chest',
      'specialty', 'puzzle', 'other'
    ))
    or (p_title is not null and v_title is not null and char_length(v_title) > 80)
    or (p_note is not null and v_note is not null and char_length(v_note) > 500)
    or (p_x is not null and (p_x < -9107 or p_x > 6176))
    or (p_y is not null and (p_y < -4288 or p_y > 7776))
  then
    raise exception using errcode = 'P0001', message = 'map:invalid';
  end if;
  select * into v_marker from public.map_markers m where m.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'map:not_found';
  end if;
  update public.map_markers m
  set status = p_status,
    type = coalesce(p_type, m.type),
    title = case when p_title is null then m.title else v_title end,
    note = case when p_note is null then m.note else v_note end,
    x = coalesce(p_x, m.x), y = coalesce(p_y, m.y),
    reviewed_by = v_user, updated_at = now()
  where m.id = p_id;
end;
$$;

create function public.map_delete_marker(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
begin
  if not public.forum_is_moderator(v_user) then
    raise exception using errcode = 'P0001', message = 'map:forbidden';
  end if;
  delete from public.map_markers m where m.id = p_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'map:not_found';
  end if;
end;
$$;

create function public.map_pending_markers(
  p_limit int default 100, p_before bigint default null
)
returns table (
  id bigint, layer text, type text, x real, y real,
  title text, note text, created_at timestamptz,
  author_id uuid, author_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.forum_is_moderator(auth.uid()) then
    raise exception using errcode = 'P0001', message = 'map:forbidden';
  end if;
  return query
  select m.id, m.layer, m.type, m.x, m.y, m.title, m.note,
    m.created_at, m.author_id,
    coalesce(nullif(btrim(p.custom->>'nick'), ''), p.display_name, p.nickname::text)
  from public.map_markers m
  left join public.profiles p on p.id = m.author_id
  where m.status = 'pending' and (p_before is null or m.id < p_before)
  order by m.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

revoke all on function public.map_suggest_marker(text, text, real, real, text, text) from public, anon, authenticated;
revoke all on function public.map_withdraw_marker(bigint) from public, anon, authenticated;
revoke all on function public.map_review_marker(bigint, text, text, text, text, real, real) from public, anon, authenticated;
revoke all on function public.map_delete_marker(bigint) from public, anon, authenticated;
revoke all on function public.map_pending_markers(int, bigint) from public, anon, authenticated;

grant execute on function public.map_suggest_marker(text, text, real, real, text, text) to authenticated;
grant execute on function public.map_withdraw_marker(bigint) to authenticated;
grant execute on function public.map_review_marker(bigint, text, text, text, text, real, real) to authenticated;
grant execute on function public.map_delete_marker(bigint) to authenticated;
grant execute on function public.map_pending_markers(int, bigint) to authenticated;

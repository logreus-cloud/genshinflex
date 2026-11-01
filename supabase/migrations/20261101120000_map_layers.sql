create or replace function public.map_suggest_marker(
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
  if p_layer is null or p_layer !~ '^[a-z0-9-]{2,32}$'
    or p_type is null or p_type not in (
      'waypoint', 'statue', 'domain', 'boss', 'oculus', 'chest',
      'specialty', 'puzzle', 'other'
    )
    or p_x is null or p_y is null
    or not (case p_layer
      when 'surface' then p_x between -9107 and 6176
        and p_y between -4288 and 7776
      when 'enkanomiya' then p_x between -184 and 3918
        and p_y between 108 and 4053
      when 'chasm' then p_x between -908 and 2509
        and p_y between 328 and 2368
      when 'sacred-mountain' then p_x between 1474 and 4310
        and p_y between 1383 and 3636
      else false
    end)
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

revoke all on function public.map_suggest_marker(text, text, real, real, text, text) from public, anon, authenticated;
grant execute on function public.map_suggest_marker(text, text, real, real, text, text) to authenticated;

alter table public.social_rate_events
drop constraint if exists social_rate_events_kind_check;
alter table public.social_rate_events
add constraint social_rate_events_kind_check
check (kind in ('follow', 'friend_request', 'dm_open', 'dm_message', 'forum_reaction', 'forum_report'));

create or replace function public.forum_rate_limit(p_user uuid, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_window interval;
begin
  if p_kind = 'forum_reaction' then
    v_limit := 60;
    v_window := interval '1 minute';
  elsif p_kind = 'forum_report' then
    v_limit := 20;
    v_window := interval '1 hour';
  else
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  delete from public.social_rate_events e
  where e.user_id = p_user and e.created_at <= now() - interval '1 day';
  if (select count(*) from public.social_rate_events e
    where e.user_id = p_user and e.kind = p_kind
      and e.created_at > now() - v_window) >= v_limit then
    raise exception using errcode = 'P0001', message = 'forum:rate_limited';
  end if;
  insert into public.social_rate_events (user_id, kind) values (p_user, p_kind);
end;
$$;

revoke all on function public.forum_rate_limit(uuid, text) from public, anon, authenticated;

create or replace function public.forum_set_reaction(p_post bigint, p_kind text, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_mod boolean := public.forum_is_moderator(v_user);
begin
  if p_kind is null or p_kind not in ('like', 'heart', 'fire', 'laugh', 'think', 'sad')
    or p_on is null then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  if not exists (
    select 1 from public.forum_posts p
    join public.forum_threads t on t.id = p.thread_id
    where p.id = p_post and p.deleted_at is null
      and (t.deleted_at is null or v_mod)
  ) then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if p_on then
    if not v_mod then
      perform public.forum_rate_limit(v_user, 'forum_reaction');
    end if;
    insert into public.forum_reactions (post_id, user_id, kind)
    values (p_post, v_user, p_kind) on conflict do nothing;
  else
    delete from public.forum_reactions r
    where r.post_id = p_post and r.user_id = v_user and r.kind = p_kind;
  end if;
end;
$$;

create or replace function public.forum_report(
  p_post bigint, p_reason text, p_comment text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.forum_write_user();
  v_author uuid;
begin
  if p_reason is null or p_reason not in ('spam', 'abuse', 'spoiler', 'offtopic', 'other')
    or (p_comment is not null and char_length(p_comment) > 500) then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  select p.author_id into v_author
  from public.forum_posts p
  join public.forum_threads t on t.id = p.thread_id
  where p.id = p_post and p.deleted_at is null and t.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'forum:not_found';
  end if;
  if v_author = v_user then
    raise exception using errcode = 'P0001', message = 'forum:invalid';
  end if;
  perform 1 from public.forum_reports r
  where r.post_id = p_post and r.reporter_id = v_user for update;
  if exists (
    select 1 from public.forum_reports r
    where r.post_id = p_post and r.reporter_id = v_user
      and r.status <> 'open'
      and r.last_submitted_at > now() - interval '1 day'
  ) then
    raise exception using errcode = 'P0001', message = 'forum:rate_limited';
  end if;
  if not public.forum_is_moderator(v_user) then
    perform public.forum_rate_limit(v_user, 'forum_report');
  end if;
  insert into public.forum_reports as r (post_id, reporter_id, reason, comment)
  values (p_post, v_user, p_reason, p_comment)
  on conflict (post_id, reporter_id) do update
  set reason = excluded.reason, comment = excluded.comment,
    status = 'open', resolved_by = null, resolved_at = null,
    submissions = case when r.last_submitted_at > now() - interval '1 hour'
      then r.submissions + 1 else 1 end,
    last_submitted_at = now();
end;
$$;

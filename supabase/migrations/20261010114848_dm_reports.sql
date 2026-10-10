create table public.dm_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.dm_messages(id) on delete cascade,
  conversation_id bigint not null references public.dm_conversations(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body_snapshot text not null,
  reason text not null check (reason in ('spam', 'abuse', 'other')),
  comment text check (char_length(comment) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);

create index dm_reports_status_idx on public.dm_reports (status, created_at);

alter table public.dm_reports enable row level security;
revoke all on public.dm_reports from public, anon, authenticated;
grant all on public.dm_reports to service_role;
grant all on sequence public.dm_reports_id_seq to service_role;

create function public.dm_report(
  p_message bigint, p_reason text, p_comment text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_message public.dm_messages%rowtype;
  v_status text;
  v_resolved_at timestamptz;
begin
  if v_user is null then
    raise exception using errcode = 'P0001', message = 'dm:auth_required';
  end if;
  if p_reason is null or p_reason not in ('spam', 'abuse', 'other')
    or (p_comment is not null and char_length(p_comment) > 500) then
    raise exception using errcode = 'P0001', message = 'dm:invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dm_report:' || v_user::text));
  select msg.* into v_message
  from public.dm_messages msg
  join public.dm_members m on m.conversation_id = msg.conversation_id
  where msg.id = p_message and msg.deleted_at is null and m.user_id = v_user
  for update of msg;
  if not found then
    raise exception using errcode = 'P0001', message = 'dm:not_found';
  end if;
  if v_message.sender_id = v_user then
    raise exception using errcode = 'P0001', message = 'dm:invalid';
  end if;
  select r.status, r.resolved_at into v_status, v_resolved_at
  from public.dm_reports r
  where r.message_id = p_message and r.reporter_id = v_user
  for update;
  if v_status = 'open' then
    update public.dm_reports r
    set reason = p_reason, comment = p_comment
    where r.message_id = p_message and r.reporter_id = v_user;
    return;
  end if;
  if found and v_status <> 'open'
    and coalesce(v_resolved_at, '-infinity'::timestamptz) > now() - interval '1 day' then
    raise exception using errcode = 'P0001', message = 'dm:rate_limited';
  end if;
  if not public.forum_is_moderator(v_user) and (
    select count(*) from public.dm_reports r
    where r.reporter_id = v_user and r.created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'dm:rate_limited';
  end if;
  if v_status is not null then
    update public.dm_reports r
    set conversation_id = v_message.conversation_id,
      author_id = v_message.sender_id, body_snapshot = v_message.body,
      reason = p_reason, comment = p_comment, status = 'open',
      resolved_by = null, resolved_at = null, created_at = now()
    where r.message_id = p_message and r.reporter_id = v_user;
  else
    insert into public.dm_reports (
      message_id, conversation_id, reporter_id, author_id,
      body_snapshot, reason, comment
    ) values (
      p_message, v_message.conversation_id, v_user, v_message.sender_id,
      v_message.body, p_reason, p_comment
    );
  end if;
end;
$$;

-- Модератор видит переписку только через жалобу.
create function public.dm_reports_queue(
  p_status text default 'open', p_limit int default 30, p_offset int default 0
)
returns table (
  id bigint, message_id bigint, reason text, comment text, status text,
  created_at timestamptz, reporter jsonb, author jsonb, body text,
  message_deleted boolean, context jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.forum_is_moderator(auth.uid()) then
    raise exception using errcode = 'P0001', message = 'dm:forbidden';
  end if;
  if p_status is not null and p_status not in ('open', 'resolved', 'dismissed') then
    raise exception using errcode = 'P0001', message = 'dm:invalid';
  end if;
  return query
  select r.id, r.message_id, r.reason, r.comment, r.status, r.created_at,
    public.forum_author_json(r.reporter_id),
    public.forum_author_json(r.author_id), r.body_snapshot,
    msg.deleted_at is not null,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ctx.id,
        'sender_id', ctx.sender_id,
        'sender', public.forum_author_json(ctx.sender_id),
        'body', case when ctx.deleted_at is null then ctx.body else null end,
        'created_at', ctx.created_at,
        'reported', ctx.id = r.message_id
      ) order by ctx.id)
      from (
        (select x.* from public.dm_messages x
         where x.conversation_id = r.conversation_id and x.id < r.message_id
         order by x.id desc limit 5)
        union all
        (select x.* from public.dm_messages x where x.id = r.message_id)
        union all
        (select x.* from public.dm_messages x
         where x.conversation_id = r.conversation_id and x.id > r.message_id
         order by x.id limit 5)
      ) ctx
    ), '[]'::jsonb)
  from public.dm_reports r
  join public.dm_messages msg on msg.id = r.message_id
  where p_status is null or r.status = p_status
  order by r.created_at, r.id
  limit least(greatest(coalesce(p_limit, 30), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.dm_report(bigint, text, text) from public, anon, authenticated;
revoke all on function public.dm_reports_queue(text, int, int) from public, anon, authenticated;
grant execute on function public.dm_report(bigint, text, text) to authenticated;
grant execute on function public.dm_reports_queue(text, int, int) to authenticated;

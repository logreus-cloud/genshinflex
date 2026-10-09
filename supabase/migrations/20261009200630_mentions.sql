create function public.notifications_forum_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nickname text;
  v_recipient uuid;
begin
  if new.deleted_at is not null
    or (tg_op = 'UPDATE' and old.body is not distinct from new.body) then
    return new;
  end if;
  for v_nickname in
    select lower(m.captures[2])
    from regexp_matches(
      new.body, '(^|[^[:alnum:]_@/])@([[:alnum:]_-]{3,24})', 'g'
    ) with ordinality as m(captures, ord)
    group by lower(m.captures[2])
    order by min(m.ord)
    limit 10
  loop
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
  end loop;
  return new;
end;
$$;

-- forum_post_notification срабатывает раньше, чтобы не дублировать ответ упоминанием.
create trigger forum_post_zz_mentions
after insert or update of body on public.forum_posts
for each row execute function public.notifications_forum_mentions();

revoke all on function public.notifications_forum_mentions()
from public, anon, authenticated;

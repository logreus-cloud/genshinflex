-- Открытие тикета под блокировкой на Discord ID: дубли, зависшие записи, один активный тикет, лимит в сутки
create function public.discord_ticket_open(p_discord_id text, p_interaction_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.discord_tickets%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('discord_ticket:' || p_discord_id)::bigint);

  delete from public.discord_ticket_interactions where created_at < now() - interval '1 day';
  insert into public.discord_ticket_interactions (id) values (p_interaction_id) on conflict do nothing;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;

  update public.discord_tickets
    set status = 'closed', closed_at = now(), updated_at = now()
    where discord_id = p_discord_id and status = 'open' and thread_id is null
      and created_at < now() - interval '2 minutes';

  update public.discord_tickets
    set status = 'open', updated_at = now()
    where discord_id = p_discord_id and status = 'closing'
      and updated_at < now() - interval '2 minutes';

  select * into ticket from public.discord_tickets
    where discord_id = p_discord_id and status in ('open', 'closing')
    limit 1;
  if found then
    if ticket.thread_id is null then
      return pg_catalog.jsonb_build_object('status', 'creating');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'exists', 'id', ticket.id, 'thread_id', ticket.thread_id);
  end if;

  if (select count(*) from public.discord_tickets
      where discord_id = p_discord_id and created_at >= now() - interval '24 hours') >= 3 then
    return pg_catalog.jsonb_build_object('status', 'limit');
  end if;

  insert into public.discord_tickets (discord_id, interaction_id)
    values (p_discord_id, p_interaction_id) returning * into ticket;
  return pg_catalog.jsonb_build_object('status', 'created', 'id', ticket.id);
end;
$$;

create function public.discord_ticket_attach(p_id bigint, p_thread_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attached boolean;
begin
  update public.discord_tickets
    set thread_id = p_thread_id, updated_at = now()
    where id = p_id and status = 'open' and thread_id is null;
  get diagnostics attached = row_count;
  return attached;
end;
$$;

create function public.discord_ticket_abandon(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Создатель тикета вызывает после подтверждённой очистки: ветки нет или она заархивирована
  delete from public.discord_tickets where id = p_id and status = 'open';
end;
$$;

revoke all on function public.discord_ticket_open(text, text) from public, anon, authenticated;
revoke all on function public.discord_ticket_attach(bigint, text) from public, anon, authenticated;
revoke all on function public.discord_ticket_abandon(bigint) from public, anon, authenticated;
grant execute on function public.discord_ticket_open(text, text) to service_role;
grant execute on function public.discord_ticket_attach(bigint, text) to service_role;
grant execute on function public.discord_ticket_abandon(bigint) to service_role;

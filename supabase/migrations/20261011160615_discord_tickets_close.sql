-- Закрытие тикетов: операция с токеном, подтверждается после архивирования ветки в Discord
create function public.discord_ticket_close_begin(p_thread_id text, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.discord_tickets%rowtype;
begin
  select * into ticket from public.discord_tickets
    where thread_id = p_thread_id order by id desc limit 1 for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'missing');
  end if;
  if ticket.status = 'closed' then
    return pg_catalog.jsonb_build_object('status', 'closed');
  end if;
  if ticket.status = 'closing' and ticket.updated_at >= now() - interval '2 minutes' then
    return pg_catalog.jsonb_build_object('status', 'closing');
  end if;

  update public.discord_tickets set status = 'closing', updated_at = now(), close_token = p_token
    where id = ticket.id;
  return pg_catalog.jsonb_build_object(
    'status', 'claimed', 'id', ticket.id, 'discord_id', ticket.discord_id);
end;
$$;

create function public.discord_ticket_close_finish(p_id bigint, p_ok boolean, p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.discord_tickets
      set status = 'closed', closed_at = now(), updated_at = now(), close_token = null
      where id = p_id and status = 'closing' and close_token = p_token;
  else
    update public.discord_tickets
      set status = 'open', updated_at = now(), close_token = null
      where id = p_id and status = 'closing' and close_token = p_token;
  end if;
end;
$$;

revoke all on function public.discord_ticket_close_begin(text, uuid) from public, anon, authenticated;
revoke all on function public.discord_ticket_close_finish(bigint, boolean, uuid) from public, anon, authenticated;
grant execute on function public.discord_ticket_close_begin(text, uuid) to service_role;
grant execute on function public.discord_ticket_close_finish(bigint, boolean, uuid) to service_role;

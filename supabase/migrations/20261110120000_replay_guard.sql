create table public.replay_guard (
  key text primary key,
  created_at timestamptz not null default now()
);

alter table public.replay_guard enable row level security;
revoke all on public.replay_guard from public, anon, authenticated;

create function public.replay_guard_claim(p_key text, p_ttl_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text;
  inserted int;
begin
  if p_key is null or length(p_key) not between 1 and 200 then
    raise exception 'Invalid replay guard key';
  end if;

  prefix := split_part(p_key, ':', 1) || ':';
  delete from public.replay_guard
  where left(key, length(prefix)) = prefix
    and created_at < now() - make_interval(secs => greatest(p_ttl_seconds, 60));

  insert into public.replay_guard (key) values (p_key) on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

revoke execute on function public.replay_guard_claim(text, int) from public, anon, authenticated;
grant execute on function public.replay_guard_claim(text, int) to service_role;

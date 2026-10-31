insert into public.rewards (id, kind, name_ru, name_en, name_es, description)
values
  ('pumpkin-lantern', 'frame', 'Тыквенный фонарь', 'Pumpkin Lantern', 'Farol de calabaza', 'За визит в Хэллоуин 2026'),
  ('halloween-night', 'glow', 'Ночь Хэллоуина', 'Halloween Night', 'Noche de Halloween', 'За визит в Хэллоуин 2026')
on conflict do nothing;

insert into public.titles (id, name_ru, name_en, name_es, color, description)
values
  ('halloween-2026', 'Хэллоуин 2026', 'Halloween 2026', 'Halloween 2026', '#ed6a4d', 'Заходил на GenshinFlex в Хэллоуин 2026')
on conflict do nothing;

-- Пользователь получает набор при входе в праздничное окно.
create or replace function public.claim_halloween_2026()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_total integer;
begin
  if v_user is null or public.account_banned(v_user) then
    return 0;
  end if;
  if now() < '2026-10-30 19:00:00+00'
    or now() >= '2026-11-01 06:00:00+00' then
    return 0;
  end if;

  with granted_rewards as (
    insert into public.user_rewards (user_id, reward_id, note)
    select v_user, reward.id, 'Хэллоуин 2026'
    from (values ('pumpkin-lantern'), ('halloween-night')) as reward(id)
    on conflict do nothing
    returning 1
  ), granted_title as (
    insert into public.user_titles (user_id, title_id, note)
    values (v_user, 'halloween-2026', 'Хэллоуин 2026')
    on conflict do nothing
    returning 1
  )
  select ((select count(*) from granted_rewards) + (select count(*) from granted_title))::integer
  into v_total;
  return v_total;
end;
$$;

revoke all on function public.claim_halloween_2026() from public, anon, authenticated;
grant execute on function public.claim_halloween_2026() to authenticated;

-- Разовая выдача тем, чья активность попала в окно до выкладки.
create or replace function public.grant_halloween_2026_backfill()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_total integer;
begin
  with eligible as (
    select u.id
    from auth.users u
    where not public.account_banned(u.id)
      and (
        (u.last_sign_in_at >= '2026-10-30 19:00:00+00'
          and u.last_sign_in_at < '2026-11-01 06:00:00+00')
        or exists (
          select 1
          from auth.sessions s
          where s.user_id = u.id
            and coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) >= '2026-10-30 19:00:00+00'
            and coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) < '2026-11-01 06:00:00+00'
        )
      )
  ), granted_rewards as (
    insert into public.user_rewards (user_id, reward_id, note)
    select e.id, reward.id, 'Хэллоуин 2026'
    from eligible e
    cross join (values ('pumpkin-lantern'), ('halloween-night')) as reward(id)
    on conflict do nothing
    returning 1
  ), granted_title as (
    insert into public.user_titles (user_id, title_id, note)
    select e.id, 'halloween-2026', 'Хэллоуин 2026'
    from eligible e
    on conflict do nothing
    returning 1
  )
  select ((select count(*) from granted_rewards) + (select count(*) from granted_title))::integer
  into v_total;
  return v_total;
end;
$$;

revoke all on function public.grant_halloween_2026_backfill() from public, anon, authenticated;
grant execute on function public.grant_halloween_2026_backfill() to service_role;

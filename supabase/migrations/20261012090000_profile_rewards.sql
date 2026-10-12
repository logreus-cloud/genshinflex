create table public.rewards (
  id text primary key check (id ~ '^[a-z0-9-]{2,32}$'),
  kind text not null check (kind in ('frame', 'glow')),
  name_ru text not null check (char_length(name_ru) between 1 and 32),
  name_en text check (char_length(name_en) <= 32),
  name_es text check (char_length(name_es) <= 32),
  description text check (char_length(description) <= 200),
  created_at timestamptz not null default now()
);

create table public.user_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id text not null references public.rewards(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  note text check (char_length(note) <= 200),
  granted_at timestamptz not null default now(),
  primary key (user_id, reward_id)
);
create index user_rewards_reward_idx on public.user_rewards (reward_id);

alter table public.rewards enable row level security;
alter table public.user_rewards enable row level security;

create policy "Читать награды"
on public.rewards for select to anon, authenticated
using (true);

create policy "Читать выданные награды"
on public.user_rewards for select to anon, authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = user_id and p.is_public
  )
);

revoke all on public.rewards, public.user_rewards from public, anon, authenticated;
grant select on public.rewards, public.user_rewards to anon, authenticated;
grant all on public.rewards, public.user_rewards to service_role;

create function public.check_profile_rewards()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.rewards
    where id = new.custom->>'frame' and kind = 'frame'
  ) then
    perform 1 from public.user_rewards
    where user_id = new.id and reward_id = new.custom->>'frame'
    for share;
    if not found then
      new.custom := jsonb_set(new.custom, '{frame}', '"none"'::jsonb);
    end if;
  end if;
  if exists (
    select 1 from public.rewards
    where id = new.custom->>'glow' and kind = 'glow'
  ) then
    perform 1 from public.user_rewards
    where user_id = new.id and reward_id = new.custom->>'glow'
    for share;
    if not found then
      new.custom := jsonb_set(new.custom, '{glow}', '"none"'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

create trigger check_profile_rewards
before insert or update of custom on public.profiles
for each row execute function public.check_profile_rewards();

create function public.clear_revoked_profile_reward()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles
  set custom = custom
    || case when custom->>'frame' = old.reward_id
      then '{"frame":"none"}'::jsonb else '{}'::jsonb end
    || case when custom->>'glow' = old.reward_id
      then '{"glow":"none"}'::jsonb else '{}'::jsonb end
  where id = old.user_id
    and (custom->>'frame' = old.reward_id or custom->>'glow' = old.reward_id);
  return old;
end;
$$;

create trigger clear_revoked_profile_reward
after delete on public.user_rewards
for each row execute function public.clear_revoked_profile_reward();

insert into public.rewards (id, kind, name_ru, name_en, name_es)
values
  ('crimson-ring', 'frame', 'Багровый взгляд', 'Crimson Gaze', 'Mirada carmesí'),
  ('crimson-aura', 'glow', 'Багровая аура', 'Crimson Aura', 'Aura carmesí')
on conflict do nothing;

insert into public.user_rewards (user_id, reward_id, note)
select roles.user_id, rewards.id, 'Админ'
from public.roles
cross join public.rewards
where roles.role = 'admin' and rewards.id in ('crimson-ring', 'crimson-aura')
on conflict do nothing;

-- Счётчики гаранта для команды /гарант: та же логика, что analyse() в src/scripts/wish-analysis.ts.
-- Порядок круток — по длине id, затем по id (cmpId в src/scripts/wish-store.ts): lpad до 32 знаков даёт тот же порядок.
create function public.discord_wish_pity(p_discord_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with linked as (
    select i.user_id
    from auth.identities i
    where i.provider = 'discord' and i.provider_id = p_discord_id
    limit 1
  ), rows as (
    select w.game_uid, w.name, w.item_id, w.rank_type,
      lpad(w.id, 32, '0') collate "C" as sort_key,
      case w.gacha_type
        when '301' then 'char' when '400' then 'char'
        when '302' then 'weapon' when '200' then 'standard' when '500' then 'chronicled'
      end as grp
    from public.wishes w
    join linked l on l.user_id = w.user_id
    where w.gacha_type <> '100'
  ), numbered as (
    select r.*, row_number() over (partition by r.game_uid, r.grp order by r.sort_key) as n
    from rows r
  ), groups as (
    select x.game_uid, x.grp, max(x.sort_key) as latest,
      jsonb_build_object(
        'key', x.grp,
        'total', count(*),
        'p5', count(*) - coalesce(max(x.n) filter (where x.rank_type = '5'), 0),
        'p4', count(*) - coalesce(max(x.n) filter (where x.rank_type in ('4', '5')), 0),
        'last5_name', (array_agg(x.name order by x.n desc) filter (where x.rank_type = '5'))[1],
        'last5_item_id', (array_agg(x.item_id order by x.n desc) filter (where x.rank_type = '5'))[1]
      ) as data
    from numbered x
    group by x.game_uid, x.grp
  ), uids as (
    select g.game_uid, max(g.latest) as latest,
      jsonb_agg(g.data order by array_position(array['char', 'weapon', 'standard', 'chronicled'], g.grp)) as groups
    from groups g
    group by g.game_uid
    order by latest desc
    limit 3
  )
  select case when exists (select 1 from linked) then jsonb_build_object('uids', coalesce(
    (select jsonb_agg(jsonb_build_object('game_uid', u.game_uid, 'groups', u.groups) order by u.latest desc) from uids u),
    '[]'::jsonb
  )) end;
$$;

revoke all on function public.discord_wish_pity(text) from public, anon, authenticated;
grant execute on function public.discord_wish_pity(text) to service_role;

comment on function public.discord_wish_pity(text) is
  'Счётчики гаранта по привязанному Discord ID только для сервисного клиента; null — Discord не привязан.';

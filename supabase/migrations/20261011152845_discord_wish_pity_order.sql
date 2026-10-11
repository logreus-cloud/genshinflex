-- Порядок круток совпадает с cmpId в src/scripts/wish-store.ts без ограничения длины id.
create or replace function public.discord_wish_pity(p_discord_id text)
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
    select w.game_uid, w.name, w.item_id, w.rank_type, w.id,
      case w.gacha_type
        when '301' then 'char' when '400' then 'char'
        when '302' then 'weapon' when '200' then 'standard' when '500' then 'chronicled'
      end as grp
    from public.wishes w
    join linked l on l.user_id = w.user_id
    where w.gacha_type <> '100'
  ), numbered as (
    select r.*, row_number() over (
      partition by r.game_uid, r.grp order by char_length(r.id), r.id collate "C"
    ) as n
    from rows r
  ), groups as (
    select x.game_uid, x.grp,
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
    select g.game_uid,
      (select r.id from rows r where r.game_uid = g.game_uid
        order by char_length(r.id) desc, r.id collate "C" desc limit 1) as latest,
      jsonb_agg(g.data order by array_position(array['char', 'weapon', 'standard', 'chronicled'], g.grp)) as groups
    from groups g
    group by g.game_uid
  ), latest_uids as (
    select u.*, row_number() over (
      order by char_length(u.latest) desc, u.latest collate "C" desc
    ) as n
    from uids u
  )
  select case when exists (select 1 from linked) then jsonb_build_object('uids', coalesce(
    (select jsonb_agg(jsonb_build_object('game_uid', u.game_uid, 'groups', u.groups) order by u.n)
      from latest_uids u where u.n <= 3),
    '[]'::jsonb
  )) end;
$$;

revoke all on function public.discord_wish_pity(text) from public, anon, authenticated;
grant execute on function public.discord_wish_pity(text) to service_role;

comment on function public.discord_wish_pity(text) is
  'Счётчики гаранта по привязанному Discord ID только для сервисного клиента; null — Discord не привязан.';

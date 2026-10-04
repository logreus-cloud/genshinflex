-- Настройки приватности публичного профиля: что из приватных данных владелец разрешил показывать на /u/ник.
-- По умолчанию всё скрыто; ключи — uid (UID и витрина), roster («Мои персонажи»), favorites (избранное), wishes (сводка круток).
alter table public.profiles
  add column if not exists privacy jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_privacy_shape') then
    alter table public.profiles add constraint profiles_privacy_shape check (
      jsonb_typeof(privacy) = 'object'
      and privacy - array['uid', 'roster', 'favorites', 'wishes'] = '{}'::jsonb
      and coalesce(jsonb_typeof(privacy->'uid'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(privacy->'roster'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(privacy->'favorites'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(privacy->'wishes'), 'boolean') = 'boolean'
    );
  end if;
end;
$$;

grant select (privacy) on public.profiles to anon, authenticated;
grant update (privacy) on public.profiles to authenticated;

-- Открытые владельцем данные публичного профиля. Читает приватные таблицы в обход RLS,
-- поэтому отдаёт только то, что включено в privacy, и только для is_public.
-- Крутки — сводка (молитвы, гаранты, последние 5★), без полной истории; без открытого UID аккаунты не подписываются номером.
create or replace function public.public_profile_extras(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_privacy jsonb;
  v_data public.user_data%rowtype;
  v_result jsonb := '{}'::jsonb;
  v_uid text;
begin
  select p.id, p.privacy into v_id, v_privacy
  from public.profiles p
  -- При пустом search_path обычный = сравнивал бы citext как text, с учётом регистра
  where p.nickname operator(extensions.=) p_nickname::extensions.citext and p.is_public;
  if v_id is null then
    return null;
  end if;

  select * into v_data from public.user_data d where d.user_id = v_id;

  if (v_privacy->>'uid')::boolean then
    v_uid := v_data.settings->>'uid';
    if v_uid ~ '^[0-9]{9,10}$' then
      v_result := v_result || jsonb_build_object('uid', v_uid);
    end if;
  end if;

  if (v_privacy->>'roster')::boolean and jsonb_typeof(v_data.roster) = 'array' then
    v_result := v_result || jsonb_build_object('roster', v_data.roster);
  end if;

  if (v_privacy->>'favorites')::boolean and jsonb_typeof(v_data.favorites) = 'object' then
    v_result := v_result || jsonb_build_object('favorites', v_data.favorites);
  end if;

  if (v_privacy->>'wishes')::boolean then
    v_result := v_result || jsonb_build_object('wishes', coalesce((
      select jsonb_agg(account order by account_order)
      from (
        select
          row_number() over (order by a.game_uid = 'manual', a.game_uid) as account_order,
          jsonb_build_object(
            'uid', case when a.game_uid = 'manual' then 'manual'
              when (v_privacy->>'uid')::boolean then a.game_uid
              else null end,
            'total', (select count(*) from public.wishes w where w.user_id = v_id and w.game_uid = a.game_uid),
            'fives', (select count(*) from public.wishes w where w.user_id = v_id and w.game_uid = a.game_uid and w.rank_type = '5'),
            'pity', (
              select jsonb_object_agg(g.name, (
                select count(*) from public.wishes w
                where w.user_id = v_id and w.game_uid = a.game_uid and w.gacha_type = any (g.types)
                  and (length(w.id), w.id) > coalesce((
                    select (length(f.id), f.id) from public.wishes f
                    where f.user_id = v_id and f.game_uid = a.game_uid and f.gacha_type = any (g.types) and f.rank_type = '5'
                    order by length(f.id) desc, f.id desc limit 1
                  ), (0, ''))
              ))
              from (values ('character', array['301', '400']), ('weapon', array['302']), ('standard', array['200'])) as g(name, types)
            ),
            'recent', coalesce((
              select jsonb_agg(jsonb_build_object('name', r.name, 'item_id', r.item_id, 'item_type', r.item_type, 'gacha_type', r.gacha_type, 'time', r.time) order by length(r.id) desc, r.id desc)
              from (
                select w.* from public.wishes w
                where w.user_id = v_id and w.game_uid = a.game_uid and w.rank_type = '5'
                order by length(w.id) desc, w.id desc limit 20
              ) r
            ), '[]'::jsonb)
          ) as account
        from (select distinct w.game_uid from public.wishes w where w.user_id = v_id) a
      ) accounts
    ), '[]'::jsonb));
  end if;

  return v_result;
end;
$$;

revoke all on function public.public_profile_extras(text) from public;
grant execute on function public.public_profile_extras(text) to anon, authenticated;

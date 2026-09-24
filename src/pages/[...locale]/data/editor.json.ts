import { getCollection } from 'astro:content';
import { useData, LANGS } from '../../../lib/data';

// Данные для редактора гайдов: справочники для выбора и баблов + текущие билды, чтобы править существующий гайд.
// Роли, статы и заметки билдов отдаём уже на языке страницы — человек правит то, что видит на сайте.
export const getStaticPaths = () => LANGS.map((l) => ({ params: { locale: l === 'ru' ? undefined : l } }));

const TEMPLATED = 'Краткий билд по данным сообщества';

export async function GET({ params }: { params: { locale?: string } }) {
  const { lang, characters, weapons, artifacts, ELEMENTS, WEAPON_TYPES, TALENTS, t, stat } = useData(params.locale);
  const i18n = lang === 'ru' ? new Map() : new Map((await getCollection('buildsI18n')).filter((e) => e.id.startsWith(`${lang}/`)).map((e) => [e.id.slice(3), e.body?.trim() ?? '']));
  const note = (s?: string) => (s ? t(s) : '');
  const builds = Object.fromEntries((await getCollection('builds')).map(({ data: b, body }) => {
    const text = lang === 'ru' ? body?.trim() ?? '' : i18n.get(b.character) ?? '';
    return [b.character, {
      character: b.character, role: t(b.role), patch: b.patch, updated: b.updated.toISOString().slice(0, 10),
      weapons: b.weapons.map((w) => ({ slug: w.slug, note: note(w.note) })),
      artifacts: b.artifacts.map((a) => ({ sets: a.sets, note: note(a.note) })),
      mainStats: { sands: stat(b.mainStats.sands), goblet: stat(b.mainStats.goblet), circlet: stat(b.mainStats.circlet) },
      substats: b.substats.map(stat), talents: b.talents,
      teams: b.teams.map((tm) => ({ name: note(tm.name), members: tm.members, note: note(tm.note) })),
      body: text.startsWith(TEMPLATED) ? '' : text,
    }];
  }));
  // Подсказки для полей статов — в тех же формулировках, что на страницах билдов
  const common = ['Сила атаки %', 'HP %', 'Защита %', 'Мастерство стихий'];
  const elDmg = ['Пиро', 'Гидро', 'Анемо', 'Электро', 'Дендро', 'Крио', 'Гео'].map((e) => `Бонус ${e} урона`);
  const body = {
    characters: characters.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, element: c.element, weapon: c.weapon, rarity: c.rarity, splash: c.splash ?? null, title: c.title })),
    weapons: weapons.map((w) => ({ slug: w.slug, name: w.name, icon: w.icon, weapon: w.weapon, rarity: w.rarity })),
    artifacts: artifacts.map((a) => ({ slug: a.slug, name: a.name, icon: a.icon, rarity: a.rarity })),
    elements: ELEMENTS,
    weaponTypes: WEAPON_TYPES,
    talents: TALENTS,
    options: {
      role: [...new Set(Object.values(builds).map((b) => b.role))].sort(),
      sands: [...common, 'Восст. энергии'].map(stat),
      goblet: [...elDmg, 'Бонус физ. урона', ...common].map(stat),
      circlet: ['Шанс / Крит. урон', 'Шанс крит. попадания', 'Крит. урон', 'Бонус лечения', ...common].map(stat),
    },
    builds,
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

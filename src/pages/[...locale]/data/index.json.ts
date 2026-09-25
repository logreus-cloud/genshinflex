import { getCollection } from 'astro:content';
import { useData, LANGS } from '../../../lib/data';

// Компактный индекс для клиента: поиск, главная, конструктор ротаций
export const getStaticPaths = () => LANGS.map((l) => ({ params: { locale: l === 'ru' ? undefined : l } }));

export async function GET({ params }: { params: { locale?: string } }) {
  const { characters, weapons, artifacts } = useData(params.locale);
  const withBuild = new Set((await getCollection('builds')).map((b) => b.data.character));
  const body = {
    characters: characters.map((c) => ({
      s: c.slug, n: c.name, e: c.nameEn, el: c.element, w: c.weapon, r: c.rarity, i: c.icon, b: withBuild.has(c.slug) ? 1 : 0,
    })),
    weapons: weapons.map((w) => ({ s: w.slug, n: w.name, e: w.nameEn, w: w.weapon, r: w.rarity, i: w.icon })),
    artifacts: artifacts.map((a) => ({ s: a.slug, n: a.name, e: a.nameEn, r: a.rarity, i: a.icon })),
    pages: [
      ['Текущая ротация: Бездна, Театр, Натиск', '/rotation'],
      ['Витая бездна: этажи 9–12', '/abyss'],
      ['Театр воображариума', '/theater'],
      ['Натиск', '/onslaught'],
      ['Баннеры: текущие и следующие', '/banners'],
      ['Календарь: баннеры, ивенты и обновления', '/calendar'],
      ['Рейтинг ELO', '/rating'],
      ['Руководства', '/guides'],
      ['Проверка команды для Бездны', '/tools/team-check'],
      ['Трекер круток: гарант и 50/50', '/tools/wishes'],
      ['Конструктор ротаций', '/tools/rotation-builder'],
      ['Калькулятор прокачки', '/tools/calculator'],
    ],
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

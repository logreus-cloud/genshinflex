import { getCollection } from 'astro:content';
import { characters, weapons, artifacts } from '../../lib/data';

// Компактный индекс для клиента: поиск, главная, конструктор ротаций
export async function GET() {
  const withBuild = new Set((await getCollection('builds')).map((b) => b.data.character));
  const body = {
    characters: characters.map((c) => ({
      s: c.slug, n: c.name, e: c.nameEn, el: c.element, w: c.weapon, r: c.rarity, i: c.icon, b: withBuild.has(c.slug) ? 1 : 0,
    })),
    weapons: weapons.map((w) => ({ s: w.slug, n: w.name, e: w.nameEn, w: w.weapon, r: w.rarity, i: w.icon })),
    artifacts: artifacts.map((a) => ({ s: a.slug, n: a.name, e: a.nameEn, r: a.rarity, i: a.icon })),
    pages: [
      ['Текущая ротация: Бездна, Театр, Натиск', '/rotation'],
      ['Баннеры: текущие и следующие', '/banners'],
      ['Рейтинг ELO', '/rating'],
      ['Руководства', '/guides'],
      ['Конструктор ротаций', '/tools/rotation-builder'],
    ],
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

// Гайды сообщества на оружие и эндгейм (коллекции weaponGuides и endgameGuides): поиск нужного на языке страницы
import { getCollection } from 'astro:content';
import type { Lang } from '../i18n';

// Ключ цикла эндгейма — дата его начала: гайд прошлого цикла автоматически скрывается
export const cycleKey = (start: Date) => start.toISOString().slice(0, 10);
// Ключ гайда эндгейма: этаж Бездны или весь режим
export const endgameKey = (mode: string, floor?: number) => (mode === 'abyss' && floor ? `abyss-${floor}` : mode);

export async function weaponGuide(slug: string, lang: Lang) {
  return (await getCollection('weaponGuides')).find((e) => e.id === `${lang}/${slug}`);
}

export async function endgameGuide(key: string, lang: Lang, start: Date) {
  const entry = (await getCollection('endgameGuides')).find((e) => e.id === `${lang}/${key}`);
  return entry && entry.data.cycle === cycleKey(start) ? entry : undefined;
}

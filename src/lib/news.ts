import { getCollection } from 'astro:content';
import type { Lang } from '../i18n';

export async function siteNews(lang: Lang) {
  const entries = (await getCollection('news', ({ data }) => data.lang === lang && !data.draft))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || a.data.anchor.localeCompare(b.data.anchor));
  const anchors = new Set<string>();
  for (const { data } of entries) {
    if (anchors.has(data.anchor)) throw new Error(`Duplicate news anchor: ${lang}/${data.anchor}`);
    anchors.add(data.anchor);
  }
  return entries;
}

export const newsDate = (date: Date, lang: Lang) => date.toLocaleDateString(
  { ru: 'ru-RU', en: 'en-US', es: 'es-ES' }[lang],
  { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' },
);

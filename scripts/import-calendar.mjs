// Импортирует мероприятия и версии из официального API объявлений Genshin Impact.
// Источник: sg-hk4e-api.hoyoverse.com, getAnnList. Запуск: node scripts/import-calendar.mjs.
// При полной недоступности API сохраняет предыдущий календарь.
import { mkdir, writeFile } from 'node:fs/promises';

const output = new URL('../src/data/generated/calendar.json', import.meta.url);
const langs = ['en', 'ru', 'es'];
const endpoint = 'https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList';
const clean = (value) => String(value ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const shortTitle = (ann) => {
  const title = clean(ann.title);
  const subtitle = clean(ann.subtitle);
  return (subtitle && subtitle.length < title.length ? subtitle : title).slice(0, 90);
};
const localTime = (value) => String(value ?? '').replace(' ', 'T').slice(0, 16);
const instant = (value) => Date.parse(`${localTime(value)}+01:00`);
const fetchLang = async (lang) => {
  const url = new URL(endpoint);
  Object.entries({ game: 'hk4e', game_biz: 'hk4e_global', lang, bundle_id: 'hk4e_global', platform: 'pc', region: 'os_euro', level: '55', uid: '100000000' }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${lang}: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.data?.list)) throw new Error(`${lang}: неожиданный формат ответа`);
  return body.data.list;
};
const byId = (groups) => new Map(groups.flatMap((group) => group.list ?? []).map((ann) => [String(ann.ann_id), ann]));
const versionNumber = (ann) => {
  const title = clean(ann.title);
  const subtitle = clean(ann.subtitle);
  return title.match(/Version (\d+\.\d+) .*?(?:Update|is Now Available|Now Live)/i)?.[1]
    ?? (/Version \d+\.\d+/i.test(subtitle) && /(?:Update Details|Details)/i.test(subtitle) ? subtitle.match(/Version (\d+\.\d+)/i)?.[1] : undefined);
};

const results = await Promise.allSettled(langs.map(fetchLang));
const groups = Object.fromEntries(langs.map((lang, index) => [lang, results[index].status === 'fulfilled' ? results[index].value : null]));
if (!groups.en) {
  console.warn('Календарь: английский ответ API недоступен, предыдущий файл сохранён.');
} else {
  const primary = groups.en;
  const maps = Object.fromEntries(langs.map((lang) => [lang, byId(groups[lang] ?? [])]));
  const now = Date.now();
  const candidates = primary.flatMap((group) => {
    if (Number(group.type_id) === 1) return (group.list ?? []).filter((ann) => !/(?:Event Wish|Epitome Invocation|Chronicled Wish)/i.test(clean(maps.en.get(String(ann.ann_id))?.title ?? ann.title))).map((ann) => ({ ann, kind: 'event' }));
    if (Number(group.type_id) === 2) return (group.list ?? []).filter((ann) => versionNumber(maps.en.get(String(ann.ann_id)) ?? ann)).map((ann) => ({ ann, kind: 'version' }));
    return [];
  });
  let seenVersion = false;
  const items = candidates.flatMap(({ ann, kind }) => {
    if (kind === 'version' && seenVersion) return [];
    const start = localTime(ann.start_time);
    const end = localTime(ann.end_time);
    const startAt = instant(start);
    const endAt = instant(end);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt || endAt - startAt > 60 * 86_400_000 || endAt < now - 120 * 86_400_000) return [];
    if (kind === 'version') seenVersion = true;
    const fallback = maps.en.get(String(ann.ann_id)) ?? maps.ru.get(String(ann.ann_id)) ?? ann;
    const version = kind === 'version' ? versionNumber(fallback) : undefined;
    const title = Object.fromEntries(langs.map((lang) => {
      const text = shortTitle(maps[lang].get(String(ann.ann_id)) ?? fallback);
      if (!version || new RegExp(`(^|\\D)${version.replace('.', '\\.')}(\\D|$)`).test(text)) return [lang, text];
      return [lang, `${({ ru: 'Версия', en: 'Version', es: 'Versión' })[lang]} ${version}`];
    }));
    return [{ id: `ann-${ann.ann_id}`, kind, start, end, image: ann.banner || undefined, title, ...(version ? { version } : {}) }];
  });
  await mkdir(new URL('../src/data/generated/', import.meta.url), { recursive: true });
  await writeFile(output, `${JSON.stringify({ updated: new Date().toISOString().slice(0, 10), items }, null, 2)}\n`);
  for (const lang of langs) if (!groups[lang]) console.warn(`Календарь: язык ${lang} недоступен, использован запасной заголовок.`);
  console.log(`Календарь: сохранено ${items.length} записей.`);
}

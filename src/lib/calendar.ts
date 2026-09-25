import { getCollection } from 'astro:content';
import type { Lang } from '../i18n/index';
import { useData } from './data';
import announcements from '../data/generated/calendar.json';
import history from '../data/generated/banner-history.json';
import manual from '../data/calendar-manual.json';

export type CalKind = 'version' | 'char-banner' | 'weapon-banner' | 'event' | 'abyss' | 'theater' | 'onslaught' | 'livestream';
export type CalItem = { id: string; kind: CalKind; start: string; end: string | null; title: string; note?: string; image?: string | null; icons?: { src: string; el?: string; name: string }[]; href?: string; estimated?: boolean; source?: { title: string; url: string } };

type Localized = Record<Lang, string>;
type Manual = { id: string; kind: 'version' | 'livestream' | 'banner' | 'event'; start: string; end?: string; estimated?: boolean; title: Localized; note?: Localized; source?: { title: string; url: string } };
type Phase = { version: string; phase?: number; start: string; end: string; featured?: { slug: string }[]; weapons?: unknown; characters?: { five?: string[] }[] };
const normalize = (value: string) => value.replace(' ', 'T').slice(0, 16);
const dateValue = (value: string) => Date.parse(`${normalize(value)}+01:00`);
const monthStart = (date: Date, delta: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
const nextCycle = (date: Date, day: number) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T04:00`;
const cycleEnd = (date: Date, day: number) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T03:59`;
const icon = (entry: unknown): { src: string; el?: string; name: string } | null => {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry as Record<string, unknown>;
  const src = value.icon;
  if (typeof src !== 'string') return null;
  return { src, el: typeof value.element === 'string' ? value.element.toLowerCase() : undefined, name: String(value.name ?? '') };
};
const slugs = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(slugs);
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return slugs(row.slug ?? row.five ?? []);
  }
  return [];
};
const known = <T>(lookup: (slug: string) => T, slug: string): T | null => {
  try { return lookup(slug); } catch { return null; }
};
const iconsOf = <T>(entries: T[]) =>
  entries.map(icon).filter((entry): entry is NonNullable<typeof entry> => !!entry);

// Ручной JSON содержит id, kind, start, необязательные end/estimated, переводы title/note и source.
// Время в источниках хранится как локальное серверное; клиент переводит его через serverMoment.
export const calendarItems = async (lang: Lang): Promise<CalItem[]> => {
  const now = Date.now();
  const cutoff = now - 120 * 86_400_000;
  const items: CalItem[] = [];
  for (const row of (announcements.items as unknown as (Manual & { image?: string })[])) {
    if (row.kind !== 'version' && row.kind !== 'event') continue;
    items.push({ id: row.id, kind: row.kind, start: normalize(row.start), end: row.end ? normalize(row.end) : null, title: row.title[lang] ?? row.title.en ?? row.title.ru, image: row.image });
  }
  for (const row of manual as Manual[]) {
    items.push({ id: row.id, kind: row.kind === 'banner' ? 'char-banner' : row.kind, start: normalize(row.start), end: row.end ? normalize(row.end) : null, title: row.title[lang] ?? row.title.ru, note: row.note?.[lang] ?? row.note?.ru, estimated: row.estimated, source: row.source });
  }

  const data = useData(lang);
  const current = (await getCollection('banners')).map((entry) => entry.data as unknown as Phase);
  const archived = history as unknown as Phase[];
  const seen = new Set(current.map((phase) => normalize(phase.start).slice(0, 10)));
  const phases = [...current, ...archived.filter((phase) => !seen.has(normalize(phase.start).slice(0, 10)))].filter((phase) => dateValue(phase.end) >= cutoff).sort((a, b) => dateValue(a.start) - dateValue(b.start));
  const phaseNumber = new Map<string, number>();
  for (const phase of phases) {
    const number = phase.phase ?? (phaseNumber.get(phase.version) ?? 0) + 1;
    phaseNumber.set(phase.version, number);
    const characterSlugs = slugs(phase.featured ?? phase.characters ?? []);
    const weaponSlugs = slugs(phase.weapons);
    const characters = characterSlugs.map((slug) => known(data.getCharacter, slug)).filter((entry): entry is NonNullable<typeof entry> => !!entry);
    const weapons = weaponSlugs.map((slug) => known(data.getWeapon, slug)).filter((entry): entry is NonNullable<typeof entry> => !!entry);
    const prefix = `${phase.version}-${normalize(phase.start)}`;
    const characterNames = characters.map((entry) => entry.name);
    const weaponNames = weapons.map((entry) => entry.name);
    items.push({ id: `char-${prefix}`, kind: 'char-banner', start: normalize(phase.start), end: normalize(phase.end), title: characterNames.join(' / ') || ({ ru: `Молитвы ${phase.version}, фаза ${number}`, en: `Wishes ${phase.version}, phase ${number}`, es: `Deseos ${phase.version}, fase ${number}` })[lang], icons: iconsOf(characters), href: '/banners/' });
    if (weapons.length) items.push({ id: `weapon-${prefix}`, kind: 'weapon-banner', start: normalize(phase.start), end: normalize(phase.end), title: weaponNames.join(' / '), icons: iconsOf(weapons), href: '/banners/' });
  }

  const rotations = await getCollection('rotations');
  for (const entry of rotations) {
    const row = entry.data;
    const start = `${row.start.toISOString().slice(0, 10)}T04:00`;
    const end = `${row.end.toISOString().slice(0, 10)}T04:00`;
    if (dateValue(end) < cutoff) continue;
    items.push({ id: `rotation-${entry.id}`, kind: row.mode, start, end, title: data.MODES[row.mode].title, note: data.t(row.cycle), href: `/${row.mode}/` });
  }

  // Прогноз охватывает ближайшие два месяца и уступает известным циклам.
  const today = new Date();
  for (let delta = -1; delta <= 2; delta++) {
    for (const [mode, day] of [['abyss', 16], ['theater', 1]] as const) {
      const month = monthStart(today, delta);
      const following = monthStart(today, delta + 1);
      const start = nextCycle(month, day);
      const end = cycleEnd(following, day);
      if (dateValue(start) > now + 62 * 86_400_000 || dateValue(end) < now) continue;
      if (items.some((item) => item.kind === mode && dateValue(item.start) < dateValue(end) && (!item.end || dateValue(item.end) > dateValue(start)))) continue;
      items.push({ id: `forecast-${mode}-${start}`, kind: mode, start, end, title: data.MODES[mode].title, estimated: true, href: `/${mode}/` });
    }
  }
  return items.sort((a, b) => dateValue(a.start) - dateValue(b.start));
};

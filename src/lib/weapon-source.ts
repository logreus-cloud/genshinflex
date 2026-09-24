// Как получить оружие: текст с официальной вики HoYoLAB (scripts/import-weapon-sources.mjs),
// разложенный по категориям, + история появлений на баннере оружия (banner-history.json, данные paimon.moe)
import sources from '../data/generated/weapon-sources.json';
import history from '../data/generated/banner-history.json';
import type { Lang } from '../i18n';

export type SourceKind = 'event-wish' | 'wish' | 'forge' | 'bp' | 'starglitter' | 'event' | 'quest' | 'fishing' | 'chest' | 'console' | 'other';
// Группа для фильтра в списке оружия: всё бесплатное из мира и ивентов — вместе
export type SourceGroup = 'event-wish' | 'wish' | 'forge' | 'bp' | 'starglitter' | 'free';

const RULES: [RegExp, SourceKind][] = [
  [/event wish/i, 'event-wish'],
  [/^wish$/i, 'wish'],
  [/forged/i, 'forge'],
  [/battle pass|bp bounty/i, 'bp'],
  [/starglitter|paimon's bargains/i, 'starglitter'],
  [/fishing/i, 'fishing'],
  [/\bevent\b/i, 'event'],
  [/quest|dialogue|adventure rank/i, 'quest'],
  [/chest/i, 'chest'],
  [/ps4|ps5|playstation/i, 'console'],
];
const ORDER: SourceKind[] = ['event-wish', 'wish', 'forge', 'bp', 'starglitter', 'event', 'quest', 'fishing', 'chest', 'console', 'other'];

const db = sources as Record<string, Record<Lang, string>>;
type Phase = { version: string; start: string; end: string; weapons: { five: string[]; four: string[] } | null };
const phases = history as unknown as Phase[];

export interface WeaponSource {
  kinds: SourceKind[];
  group: SourceGroup | null;
  // Подробности с вики на языке страницы: название ивента, задания и т. п.
  text: string | null;
  // Появления на баннере оружия, от новых к старым
  banners: { version: string; start: string; end: string }[];
  onBannerNow: boolean;
}

export function weaponSource(slug: string, lang: Lang): WeaponSource {
  const row = db[slug];
  const parts = row?.en.split(/;\s*/).filter(Boolean) ?? [];
  const kinds = [...new Set(parts.map((p) => RULES.find(([re]) => re.test(p))?.[1]).filter(Boolean) as SourceKind[])];
  if (row && !kinds.length) kinds.push('other');
  kinds.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const main = kinds[0];
  const group: SourceGroup | null = !main ? null
    : (['event-wish', 'wish', 'forge', 'bp', 'starglitter'] as const).includes(main as never) ? main as SourceGroup : 'free';
  // Текст нужен, только когда категория сама по себе ничего не объясняет: ивент, задание, рыбалка и т. д.
  const needsText = kinds.some((k) => ['event', 'quest', 'fishing', 'chest', 'console', 'other'].includes(k));
  const banners = phases
    .filter((p) => p.weapons && [...p.weapons.five, ...p.weapons.four].includes(slug))
    .map((p) => ({ version: p.version, start: p.start.slice(0, 10), end: p.end.slice(0, 10) }))
    .reverse();
  const today = new Date().toISOString().slice(0, 10);
  return { kinds, group, text: needsText ? row?.[lang] ?? null : null, banners, onBannerNow: banners.some((b) => b.start <= today && today <= b.end) };
}

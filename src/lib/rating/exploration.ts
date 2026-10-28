import { scoreRole } from './core';

export type ExploreCategory = 'movement' | 'gathering' | 'utility' | 'convenience';
export type ExploreTag =
  | 'kit-sprint' | 'kit-flight' | 'kit-vertical' | 'kit-water'
  | 'sprint-stamina' | 'climb-stamina' | 'glide-stamina' | 'glide-speed' | 'swim-stamina' | 'underwater-speed' | 'move-speed'
  | 'specialties' | 'ore' | 'no-startle' | 'harvest'
  | 'utility'
  | 'expedition' | 'crafting' | 'cooking';

export const EXPLORE_CATEGORIES: Record<ExploreCategory, string> = {
  movement: 'Передвижение',
  gathering: 'Сбор',
  utility: 'Польза',
  convenience: 'Удобство',
};

export const EXPLORE_TAGS: Record<ExploreTag, { category: ExploreCategory; points: number; label: string }> = {
  'kit-sprint': { category: 'movement', points: 3, label: 'Быстрое передвижение навыком' },
  'kit-flight': { category: 'movement', points: 3, label: 'Полёт' },
  'kit-vertical': { category: 'movement', points: 2, label: 'Подъём в воздух' },
  'kit-water': { category: 'movement', points: 2, label: 'Передвижение по воде' },
  'sprint-stamina': { category: 'movement', points: 2, label: 'Бег: −20% выносливости' },
  'climb-stamina': { category: 'movement', points: 2, label: 'Лазание: −20% выносливости' },
  'glide-stamina': { category: 'movement', points: 2, label: 'Планирование: −20% выносливости' },
  'glide-speed': { category: 'movement', points: 2, label: 'Планирование: +15% скорости' },
  'swim-stamina': { category: 'movement', points: 1, label: 'Плавание: меньше выносливости' },
  'underwater-speed': { category: 'movement', points: 1, label: 'Под водой: быстрее' },
  'move-speed': { category: 'movement', points: 1, label: 'Скорость передвижения днём или ночью' },
  specialties: { category: 'gathering', points: 2, label: 'Местные диковинки на мини-карте' },
  ore: { category: 'gathering', points: 1, label: 'Руда на мини-карте' },
  'no-startle': { category: 'gathering', points: 1, label: 'Не пугает животных' },
  harvest: { category: 'gathering', points: 2, label: 'Сбор на расстоянии или с бонусом' },
  utility: { category: 'utility', points: 1, label: 'Особая польза вне боя' },
  expedition: { category: 'convenience', points: 0.5, label: 'Экспедиции' },
  crafting: { category: 'convenience', points: 0.5, label: 'Крафт' },
  cooking: { category: 'convenience', points: 0.5, label: 'Готовка' },
};

const PASSIVE_RULES: [ExploreTag, RegExp][] = [
  ['sprint-stamina', /sprinting stamina/i],
  ['climb-stamina', /climbing stamina/i],
  ['glide-stamina', /gliding stamina/i],
  ['glide-speed', /gliding spd/i],
  ['swim-stamina', /(swimming|aquatic) stamina/i],
  ['underwater-speed', /underwater sprint spd/i],
  ['move-speed', /swift stride|movement spd/i],
  ['specialties', /(resources unique to|local specialties).*mini-?map|mini-?map.*(resources unique to|local specialties)/i],
  ['ore', /ore veins/i],
  ['no-startle', /not (be )?startle/i],
  ['harvest', /harvestable items within a fixed aoe/i],
  ['expedition', /expedition/i],
  ['crafting', /crafts?|crafting|refund.*ore|ascending|obtain wood|fish successfully/i],
  ['cooking', /cook|dish|food/i],
];

export function passiveTags(text: string): ExploreTag[] {
  const tags: ExploreTag[] = [];
  for (const [tag, pattern] of PASSIVE_RULES) {
    if (tag === 'move-speed' && /in combat|while in an area with phlogiston/i.test(text) && !/swift stride/i.test(text)) continue;
    if (pattern.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  if (!tags.length && /recovery orbs|treasure compass|fontemer|underwater|revive|nightsoul transmission|heal your current active character|snack rewards|quick arrow/i.test(text)) tags.push('utility');
  return tags;
}

export function explorationTags(passives: { description: string }[], kit: ExploreTag[] = []): ExploreTag[] {
  const found = new Set<ExploreTag>(kit);
  for (const passive of passives) for (const tag of passiveTags(passive.description)) found.add(tag);
  return (Object.keys(EXPLORE_TAGS) as ExploreTag[]).filter((tag) => found.has(tag));
}

export function explorationScore(tags: ExploreTag[]): number {
  return tags.reduce((sum, tag) => sum + EXPLORE_TAGS[tag].points, 0);
}

export function rankExploration(rows: { slug: string; tags: ExploreTag[] }[]) {
  return scoreRole(rows.filter((row) => row.tags.length).map((row) => ({ ...row, value: explorationScore(row.tags) })));
}

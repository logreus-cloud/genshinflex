import characters from '../data/generated/characters.json';
import weapons from '../data/generated/weapons.json';
import artifacts from '../data/generated/artifacts.json';

export type Character = (typeof characters)[number];
export type Weapon = (typeof weapons)[number];
export type Artifact = (typeof artifacts)[number];

const index = <T extends { slug: string }>(list: T[]) => new Map(list.map((x) => [x.slug, x]));
const byCharacter = index(characters);
const byWeapon = index(weapons);
const byArtifact = index(artifacts);

// Ссылка на несуществующий слаг — ошибка контента, роняем сборку, чтобы её заметили
const must = <T>(map: Map<string, T>, kind: string) => (slug: string): T => {
  const item = map.get(slug);
  if (!item) throw new Error(`Неизвестный ${kind}: "${slug}"`);
  return item;
};

export { characters, weapons, artifacts };
export const getCharacter = must(byCharacter, 'персонаж');
export const getWeapon = must(byWeapon, 'оружие');
export const getArtifact = must(byArtifact, 'сет артефактов');

export const ELEMENTS: Record<string, string> = {
  pyro: 'Пиро', hydro: 'Гидро', anemo: 'Анемо', electro: 'Электро',
  dendro: 'Дендро', cryo: 'Крио', geo: 'Гео',
};
export const WEAPON_TYPES: Record<string, string> = {
  sword: 'Одноручный меч', claymore: 'Двуручный меч', polearm: 'Древковое',
  bow: 'Лук', catalyst: 'Катализатор',
};
export const MODES: Record<string, { title: string; short: string }> = {
  abyss: { title: 'Витая бездна', short: 'Бездна' },
  theater: { title: 'Театр воображариума', short: 'Театр' },
  onslaught: { title: 'Натиск', short: 'Натиск' },
};
export const TALENTS = { normal: 'Обычная атака', skill: 'Элементальный навык', burst: 'Взрыв стихии' } as const;

export const fmtDate = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

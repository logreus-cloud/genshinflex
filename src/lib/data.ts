import characters from '../data/generated/characters.json';
import weapons from '../data/generated/weapons.json';
import artifacts from '../data/generated/artifacts.json';
import charactersEn from '../data/generated/characters.en.json';
import weaponsEn from '../data/generated/weapons.en.json';
import artifactsEn from '../data/generated/artifacts.en.json';
import charactersEs from '../data/generated/characters.es.json';
import weaponsEs from '../data/generated/weapons.es.json';
import artifactsEs from '../data/generated/artifacts.es.json';
import { translate, type Lang } from '../i18n';

import beta from '../data/beta-characters.json';

export type { Lang };
// beta — персонаж из утечек: данных мало, в инструментах (проверка команды, конструктор ротаций) не участвует
export type Character = (typeof characters)[number] & { beta?: boolean; betaMaterials?: string[][] };
export type Weapon = (typeof weapons)[number];
export type Artifact = (typeof artifacts)[number];
export const BETA_SOURCE = beta.source;


const index = <T extends { slug: string }>(list: T[]) => new Map(list.map((x) => [x.slug, x]));
// Ссылка на несуществующий слаг — ошибка контента, роняем сборку, чтобы её заметили
const must = <T>(map: Map<string, T>, kind: string) => (slug: string): T => {
  const item = map.get(slug);
  if (!item) throw new Error(`Неизвестный ${kind}: "${slug}"`);
  return item;
};

const LOCALE_TAG: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };

const ELEMENTS: Record<Lang, Record<string, string>> = {
  ru: { pyro: 'Пиро', hydro: 'Гидро', anemo: 'Анемо', electro: 'Электро', dendro: 'Дендро', cryo: 'Крио', geo: 'Гео' },
  en: { pyro: 'Pyro', hydro: 'Hydro', anemo: 'Anemo', electro: 'Electro', dendro: 'Dendro', cryo: 'Cryo', geo: 'Geo' },
  es: { pyro: 'Pyro', hydro: 'Hydro', anemo: 'Anemo', electro: 'Electro', dendro: 'Dendro', cryo: 'Cryo', geo: 'Geo' },
};
const WEAPON_TYPES: Record<Lang, Record<string, string>> = {
  ru: { sword: 'Одноручный меч', claymore: 'Двуручный меч', polearm: 'Древковое', bow: 'Лук', catalyst: 'Катализатор' },
  en: { sword: 'Sword', claymore: 'Claymore', polearm: 'Polearm', bow: 'Bow', catalyst: 'Catalyst' },
  es: { sword: 'Espada ligera', claymore: 'Mandoble', polearm: 'Lanza', bow: 'Arco', catalyst: 'Catalizador' },
};
const MODES: Record<Lang, Record<string, { title: string; short: string }>> = {
  ru: { abyss: { title: 'Витая бездна', short: 'Бездна' }, theater: { title: 'Театр воображариума', short: 'Театр' }, onslaught: { title: 'Натиск', short: 'Натиск' } },
  en: { abyss: { title: 'Spiral Abyss', short: 'Abyss' }, theater: { title: 'Imaginarium Theater', short: 'Theater' }, onslaught: { title: 'Stygian Onslaught', short: 'Onslaught' } },
  es: { abyss: { title: 'Abismo de Espiral', short: 'Abismo' }, theater: { title: 'Teatro Imaginario', short: 'Teatro' }, onslaught: { title: 'Embestida Estigia', short: 'Embestida' } },
};
const TALENTS: Record<Lang, { normal: string; skill: string; burst: string }> = {
  ru: { normal: 'Обычная атака', skill: 'Элементальный навык', burst: 'Взрыв стихии' },
  en: { normal: 'Normal Attack', skill: 'Elemental Skill', burst: 'Elemental Burst' },
  es: { normal: 'Ataque Normal', skill: 'Habilidad Elemental', burst: 'Habilidad Definitiva' },
};

// Названия статов в билдах хранятся по-русски («Сила атаки % / Восст. энергии») — переводим по фразам игровых терминов
const EL_RU: Record<string, string> = { 'Пиро': 'pyro', 'Гидро': 'hydro', 'Анемо': 'anemo', 'Электро': 'electro', 'Дендро': 'dendro', 'Крио': 'cryo', 'Гео': 'geo' };
const STAT_TERMS: Record<Exclude<Lang, 'ru'>, [RegExp, string | ((el: string) => string)][]> = {
  en: [
    [/Шанс \/ Крит\. урон/g, 'CRIT Rate / DMG'], [/Шанс крит\. попадания/g, 'CRIT Rate'], [/Крит\. урон/g, 'CRIT DMG'],
    [/Сила атаки %/g, 'ATK%'], [/Сила атаки/g, 'ATK'], [/Защита %/g, 'DEF%'], [/Защита/g, 'DEF'], [/Мастерство стихий/g, 'Elemental Mastery'],
    [/Восст\. энергии/g, 'Energy Recharge'], [/Бонус лечения/g, 'Healing Bonus'], [/Бонус физ\. урона/g, 'Physical DMG Bonus'],
    [/Бонус (\S+) урона/g, (el) => `${ELEMENTS.en[EL_RU[el]] ?? el} DMG Bonus`], [/Любой/g, 'Any'],
  ],
  es: [
    [/Шанс \/ Крит\. урон/g, 'Prob. / Daño CRIT'], [/Шанс крит\. попадания/g, 'Prob. CRIT'], [/Крит\. урон/g, 'Daño CRIT'],
    [/Сила атаки %/g, 'ATQ %'], [/Сила атаки/g, 'ATQ'], [/Защита %/g, 'DEF %'], [/Защита/g, 'DEF'], [/Мастерство стихий/g, 'Maestría Elemental'],
    [/Восст\. энергии/g, 'Recarga de Energía'], [/Бонус лечения/g, 'Bono de Curación'], [/Бонус физ\. урона/g, 'Bono de Daño Físico'],
    [/Бонус (\S+) урона/g, (el) => `Bono de Daño ${ELEMENTS.es[EL_RU[el]] ?? el}`], [/Любой/g, 'Cualquiera'],
  ],
};
const translateStat = (lang: Lang, s: string) => lang === 'ru' ? s
  : STAT_TERMS[lang].reduce((acc, [re, to]) => acc.replace(re, (_m, el) => (typeof to === 'function' ? to(el) : to)), s);

// Эндгейм обновляется в 04:00 по времени сервера — строка для data-until
export const resetAt = (d: Date) => `${d.toISOString().slice(0, 10)}T04:00`;
export const stars = (n: number) => '★'.repeat(n);
export const LANGS: Lang[] = ['ru', 'en', 'es'];
// Префикс ссылок: русский — в корне, остальные — /en, /es
export const prefixOf = (lang: Lang) => (lang === 'ru' ? '' : `/${lang}`);
export const toLang = (v: string | undefined): Lang => (v === 'en' || v === 'es' ? v : 'ru');

// Утечки дописываем в конец списка в том же формате, что и сгенерированные персонажи
const betaCharacters = (lang: Lang): Character[] => beta.characters.map((b) => {
  const t = translate(lang);
  const text = b.i18n[lang];
  return {
    id: 0, slug: b.slug, nameEn: text.nameEn, name: text.name,
    title: t('Утечка из бета-версии'),
    description: t('Персонаж из утечек бета-версии. Имя, стихия, характеристики и материалы могут измениться к релизу.'),
    rarity: b.rarity, element: b.element, elementText: ELEMENTS[lang][b.element], weapon: b.weapon, weaponText: WEAPON_TYPES[lang][b.weapon],
    region: '', constellationName: '', birthday: '', substat: text.substat, version: '',
    icon: `/img/beta/${b.slug}-icon.webp`, card: `/img/beta/${b.slug}-icon.webp`, splash: `/img/beta/${b.slug}-splash.webp`, emblem: null,
    stats: [{ level: '90', ...b.stats }], substatPercent: b.substatPercent,
    talents: { normal: null, skill: null, burst: null, passives: [] } as unknown as Character['talents'],
    constellations: [],
    beta: true, betaMaterials: b.materials,
  } as Character;
});

const SOURCES = {
  ru: { characters: [...characters, ...betaCharacters('ru')] as Character[], weapons, artifacts },
  en: { characters: [...(charactersEn as Character[]), ...betaCharacters('en')], weapons: weaponsEn as Weapon[], artifacts: artifactsEn as Artifact[] },
  es: { characters: [...(charactersEs as Character[]), ...betaCharacters('es')], weapons: weaponsEs as Weapon[], artifacts: artifactsEs as Artifact[] },
};

// Всё языкозависимое для страницы: данные, подписи, форматирование, префикс ссылок и перевод интерфейса
export function useData(locale: string | undefined) {
  const lang = toLang(locale);
  const src = SOURCES[lang];
  const tag = LOCALE_TAG[lang];
  return {
    lang,
    base: prefixOf(lang),
    t: translate(lang),
    ...src,
    getCharacter: must(index(src.characters), 'персонаж'),
    getWeapon: must(index(src.weapons), 'оружие'),
    getArtifact: must(index(src.artifacts), 'сет артефактов'),
    ELEMENTS: ELEMENTS[lang],
    WEAPON_TYPES: WEAPON_TYPES[lang],
    MODES: MODES[lang],
    TALENTS: TALENTS[lang],
    fmtDate: (d: Date) => d.toLocaleDateString(tag, { day: 'numeric', month: 'long' }),
    fmtFullDate: (d: Date) => d.toLocaleDateString(tag),
    // Дата из строки времени сервера «2026-10-13T18:00» — для подписей без часового пояса
    fmtServerDate: (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString(tag, { day: 'numeric', month: 'long' }),
    fmtStat: (v: number | null, percent: boolean) =>
      v === null ? '—' : percent ? `${v.toLocaleString(tag, { minimumFractionDigits: 1 })}%` : v.toLocaleString(tag),
    fmtNumber: (v: number) => v.toLocaleString(tag),
    stars,
    resetAt,
    stat: (s: string) => translateStat(lang, s),
  };
}
export type Data = ReturnType<typeof useData>;

// Русские данные — для мест, где язык не важен (слаги, sitemap)
export { characters, weapons, artifacts };

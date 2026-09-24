// Импорт открытых данных игры из genshin-db в компактные JSON для сайта.
// Запуск: npm run import
import { writeFileSync, mkdirSync } from 'node:fs';
import genshin from 'genshin-db';

const OUT = new URL('../src/data/generated/', import.meta.url);
const LANG = { resultLanguage: 'Russian' };
const CDN = 'https://enka.network/ui/';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const img = (file) => (file ? `${CDN}${file}.png` : null);
const names = (fn) => fn('names', { matchCategories: true });
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// Путешественник в genshin-db разбит на Aether/Lumine и манекены — их пока пропускаем.
const SKIP = new Set(['Aether', 'Lumine', 'Manekin', 'Manekina']);

const ELEMENTS = {
  ELEMENT_PYRO: 'pyro', ELEMENT_HYDRO: 'hydro', ELEMENT_ANEMO: 'anemo', ELEMENT_ELECTRO: 'electro',
  ELEMENT_DENDRO: 'dendro', ELEMENT_CRYO: 'cryo', ELEMENT_GEO: 'geo',
};
const WEAPONS = {
  WEAPON_SWORD_ONE_HAND: 'sword', WEAPON_CLAYMORE: 'claymore', WEAPON_POLE: 'polearm',
  WEAPON_BOW: 'bow', WEAPON_CATALYST: 'catalyst',
};
// Статы без процентов; всё остальное в genshin-db хранится долями
const FLAT = new Set(['FIGHT_PROP_ELEMENT_MASTERY', 'FIGHT_PROP_BASE_ATTACK']);

// Точки уровней, которые показывает ползунок: «20+» — после возвышения
const CHAR_LEVELS = ['1', '20', '20+', '40', '40+', '50', '50+', '60', '60+', '70', '70+', '80', '80+', '90', '95', '100'];
const WEAPON_LEVELS = CHAR_LEVELS.slice(0, 14);
const at = (stats, l) => (l.endsWith('+') ? stats(Number(l.slice(0, -1)), '+') : stats(Number(l)));
const statValue = (v, type) => (FLAT.has(type) ? round(v, 0) : round(v * 100, 1));

// «Урон навыка|{param1:F1P}» → строка значений по уровням таланта
function formatParam(value, fmt) {
  const pct = fmt.endsWith('P');
  const digits = Number(fmt.match(/F(\d)/)?.[1] ?? 0);
  const v = pct ? value * 100 : value;
  return (fmt.startsWith('I') ? Math.round(v) : v.toFixed(digits)).toString().replace('.', ',') + (pct ? '%' : '');
}
function scaling(attributes) {
  if (!attributes?.labels) return [];
  const levels = attributes.parameters.param1?.length ?? 0;
  return attributes.labels.map((label) => {
    const [name, template = ''] = label.split('|');
    const values = Array.from({ length: levels }, (_, i) =>
      template.replace(/\{(param\d+):([A-Z0-9]+)\}/g, (_, p, f) => {
        const v = attributes.parameters[p]?.[i];
        return v === undefined ? '?' : formatParam(v, f);
      }));
    return { name, values };
  });
}

const talent = (t, icon, withScaling = false) =>
  t && { name: t.name, description: t.description, icon: img(icon), ...(withScaling && { scaling: scaling(t.attributes) }) };

const ELEMENT_RU = { pyro: 'Пиро', hydro: 'Гидро', anemo: 'Анемо', electro: 'Электро', dendro: 'Дендро', cryo: 'Крио', geo: 'Гео' };

// Путешественник: статы и внешность — от Люмин, таланты и созвездия — от стихийной версии
const travelers = Object.values(ELEMENTS).map((el) => ({
  en: `Traveler (${el[0].toUpperCase()}${el.slice(1)})`, base: 'Lumine', element: el,
})).filter((t) => genshin.talents(t.en));

const characters = [
  ...names(genshin.characters).filter((n) => !SKIP.has(n)).map((en) => ({ en, base: en, element: null })),
  ...travelers,
]
  .map(({ en, base, element }) => {
    const c = genshin.characters(base, LANG);
    const t = genshin.talents(en, LANG) ?? {};
    const k = genshin.constellations(en, LANG) ?? {};
    const ti = t.images ?? {};
    const ki = k.images ?? {};
    return {
      id: c.id,
      slug: slug(en),
      nameEn: en,
      name: element ? `Путешественник (${ELEMENT_RU[element]})` : c.name,
      title: c.title,
      description: c.description,
      rarity: c.rarity,
      element: element ?? ELEMENTS[c.elementType] ?? 'none',
      elementText: element ? ELEMENT_RU[element] : c.elementText,
      weapon: WEAPONS[c.weaponType],
      weaponText: c.weaponText,
      region: c.affiliation,
      constellationName: c.constellation,
      birthday: c.birthday,
      substat: c.substatText,
      version: c.version,
      icon: img(c.images?.filename_icon),
      card: img(c.images?.filename_iconCard),
      splash: img(c.images?.filename_gachaSplash),
      // У Путешественника одна внешность на все стихии — различаем по иконке элементального навыка
      emblem: element ? img(ti.filename_combat2) : null,
      stats: CHAR_LEVELS.map((l) => {
        const s = at(c.stats, l);
        return { level: l, hp: round(s.hp, 0), atk: round(s.attack, 0), def: round(s.defense, 0), sub: statValue(s.specialized, c.substatType) };
      }),
      substatPercent: !FLAT.has(c.substatType),
      talents: {
        normal: talent(t.combat1, ti.filename_combat1, true),
        skill: talent(t.combat2, ti.filename_combat2, true),
        burst: talent(t.combat3, ti.filename_combat3, true),
        passives: [1, 2, 3, 4].map((i) => talent(t[`passive${i}`], ti[`filename_passive${i}`])).filter(Boolean),
      },
      constellations: [1, 2, 3, 4, 5, 6].map((i) => talent(k[`c${i}`], ki[`filename_c${i}`])).filter(Boolean),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

const weapons = names(genshin.weapons)
  .map((en) => {
    const w = genshin.weapons(en, LANG);
    return {
      id: w.id,
      slug: slug(en),
      nameEn: en,
      name: w.name,
      rarity: w.rarity,
      weapon: WEAPONS[w.weaponType],
      weaponText: w.weaponText,
      mainStat: w.mainStatText ?? null,
      mainStatPercent: w.mainStatType ? !FLAT.has(w.mainStatType) : false,
      description: w.description,
      effectName: w.effectName ?? null,
      refinements: ['r1', 'r2', 'r3', 'r4', 'r5'].map((r) => w[r]?.description).filter(Boolean),
      // У 1–2★ оружия потолок ниже 90 — лишние точки отбрасываем
      stats: WEAPON_LEVELS.map((l) => [l, at(w.stats, l)]).filter(([, s]) => s).map(([l, s]) => (
        { level: l, atk: round(s.attack, 0), sub: s.specialized ? statValue(s.specialized, w.mainStatType) : null }
      )),
      version: w.version,
      icon: img(w.images?.filename_icon),
      iconAwaken: img(w.images?.filename_awakenIcon),
    };
  })
  .filter((w) => w.rarity >= 3)
  // У некоторых предметов в genshin-db несколько вариантов с одним именем — оставляем первый
  .filter((w, i, all) => all.findIndex((x) => x.slug === w.slug) === i)
  .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'ru'));

const artifacts = names(genshin.artifacts)
  .map((en) => {
    const a = genshin.artifacts(en, LANG);
    return {
      id: a.id,
      slug: slug(en),
      nameEn: en,
      name: a.name,
      rarity: Math.max(...(a.rarityList ?? [0])),
      bonus2: a.effect2Pc ?? null,
      bonus4: a.effect4Pc ?? null,
      version: a.version,
      icon: img(a.images?.filename_flower),
    };
  })
  .filter((a) => a.rarity >= 4)
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

mkdirSync(OUT, { recursive: true });
for (const [file, data] of Object.entries({ characters, weapons, artifacts })) {
  writeFileSync(new URL(`${file}.json`, OUT), JSON.stringify(data));
  console.log(`${file}: ${data.length}`);
}

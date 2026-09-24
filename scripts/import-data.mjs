// Импорт открытых данных игры из genshin-db в компактные JSON для сайта.
// Запуск: npm run import
import { writeFileSync, mkdirSync } from 'node:fs';
import genshin from 'genshin-db';

const OUT = new URL('../src/data/generated/', import.meta.url);
const LANG = { resultLanguage: 'Russian' };
const ICON_CDN = 'https://enka.network/ui/';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const icon = (file) => (file ? `${ICON_CDN}${file}.png` : null);
const names = (fn) => fn('names', { matchCategories: true });

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

const talent = (t) => t && { name: t.name, description: t.description };

const characters = names(genshin.characters)
  .filter((n) => !SKIP.has(n))
  .map((en) => {
    const c = genshin.characters(en, LANG);
    const t = genshin.talents(en, LANG) ?? {};
    const k = genshin.constellations(en, LANG) ?? {};
    return {
      slug: slug(en),
      nameEn: en,
      name: c.name,
      title: c.title,
      description: c.description,
      rarity: c.rarity,
      element: ELEMENTS[c.elementType] ?? 'none',
      elementText: c.elementText,
      weapon: WEAPONS[c.weaponType],
      weaponText: c.weaponText,
      region: c.affiliation,
      substat: c.substatText,
      version: c.version,
      icon: icon(c.images?.filename_icon),
      splash: icon(c.images?.filename_gachaSplash),
      talents: {
        normal: talent(t.combat1),
        skill: talent(t.combat2),
        burst: talent(t.combat3),
        passives: [t.passive1, t.passive2, t.passive3, t.passive4].filter(Boolean).map(talent),
      },
      constellations: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((i) => talent(k[i])).filter(Boolean),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

const weapons = names(genshin.weapons)
  .map((en) => {
    const w = genshin.weapons(en, LANG);
    return {
      slug: slug(en),
      nameEn: en,
      name: w.name,
      rarity: w.rarity,
      weapon: WEAPONS[w.weaponType],
      mainStat: w.mainStatText,
      effectName: w.effectName,
      icon: icon(w.images?.filename_icon),
    };
  })
  .filter((w) => w.rarity >= 3);

const artifacts = names(genshin.artifacts)
  .map((en) => {
    const a = genshin.artifacts(en, LANG);
    return {
      slug: slug(en),
      nameEn: en,
      name: a.name,
      rarity: Math.max(...(a.rarityList ?? [0])),
      bonus2: a.effect2Pc ?? null,
      bonus4: a.effect4Pc ?? null,
      icon: icon(a.images?.filename_flower),
    };
  })
  .filter((a) => a.rarity >= 4);

mkdirSync(OUT, { recursive: true });
for (const [file, data] of Object.entries({ characters, weapons, artifacts })) {
  writeFileSync(new URL(`${file}.json`, OUT), JSON.stringify(data));
  console.log(`${file}: ${data.length}`);
}

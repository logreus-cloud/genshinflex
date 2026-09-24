// Данные для калькулятора прокачки: public/data/levelup.json
//  - опыт по уровням персонажа и оружия — из игровых таблиц (AnimeGameData, ExcelBinOutput);
//  - материалы возвышения персонажей, оружия и талантов — из genshin-db;
//  - названия и иконки материалов на трёх языках.
// Запуск: node scripts/import-levelup.mjs (входит в npm run import)
import genshin from 'genshin-db';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const EXCEL = 'https://gitlab.com/Dimbreath/AnimeGameData/-/raw/master/ExcelBinOutput';
const LOCALES = { ru: 'Russian', en: 'English', es: 'Spanish' };
// На enka.network есть не все иконки материалов — берём с gi.yatta.moe
const CDN = 'https://gi.yatta.moe/assets/UI/';

const excel = (name) => fetch(`${EXCEL}/${name}.json`, { signal: AbortSignal.timeout(60_000) }).then((r) => r.json());
const avatarLevels = await excel('AvatarLevelExcelConfigData');
const weaponLevels = await excel('WeaponLevelExcelConfigData');
// exp[i] — сколько опыта нужно с уровня i+1 до i+2
const exp = {
  avatar: avatarLevels.sort((a, b) => a.level - b.level).filter((x) => x.level < 90).map((x) => x.exp),
  weapon: weaponLevels.sort((a, b) => a.level - b.level).filter((x) => x.level < 90).map((x) => x.requiredExps),
};
if (exp.avatar.reduce((s, x) => s + x, 0) !== 8362650) throw new Error('таблица опыта персонажей изменилась — проверьте данные');

const materials = new Map();
// Стоимость одного шага: [[id материала, количество], …]
const pack = (list = []) => list.map((m) => { materials.set(m.id, m.name); return [m.id, m.count]; });

const characters = {};
for (const c of JSON.parse(readFileSync('src/data/generated/characters.en.json', 'utf8'))) {
  const base = genshin.characters(c.slug.startsWith('traveler-') ? 'Lumine' : c.nameEn);
  const talents = genshin.talents(c.nameEn);
  if (!base?.costs || !talents?.costs) { console.warn(`нет стоимости: ${c.nameEn}`); continue; }
  characters[c.slug] = {
    asc: [1, 2, 3, 4, 5, 6].map((n) => pack(base.costs[`ascend${n}`])),
    talents: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => pack(talents.costs[`lvl${n}`])),
  };
}

const weapons = {};
for (const w of JSON.parse(readFileSync('src/data/generated/weapons.en.json', 'utf8'))) {
  const data = genshin.weapons(w.nameEn);
  if (!data?.costs) continue;
  weapons[w.slug] = { rarity: w.rarity, asc: [1, 2, 3, 4, 5, 6].map((n) => pack(data.costs[`ascend${n}`])) };
}

// Книги опыта и руда усиления — считаются из опыта, а не из стоимости возвышения
for (const name of ["Hero's Wit", "Adventurer's Experience", "Wanderer's Advice", 'Mystic Enhancement Ore', 'Fine Enhancement Ore', 'Enhancement Ore', 'Mora']) {
  const m = genshin.materials(name);
  materials.set(m.id, m.name);
}

const matOut = {};
for (const [id, nameEn] of materials) {
  const m = genshin.materials(nameEn);
  matOut[id] = {
    rarity: m?.rarity ?? 1,
    sort: m?.sortRank ?? 0,
    icon: m?.images?.filename_icon ? `${CDN}${m.images.filename_icon}.png` : null,
    ...Object.fromEntries(Object.entries(LOCALES).map(([code, lang]) => [code, genshin.materials(nameEn, { resultLanguage: lang })?.name ?? nameEn])),
  };
}

mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/levelup.json', JSON.stringify({ exp, characters, weapons, materials: matOut }));
console.log(`калькулятор: персонажей ${Object.keys(characters).length}, оружия ${Object.keys(weapons).length}, материалов ${materials.size}`);

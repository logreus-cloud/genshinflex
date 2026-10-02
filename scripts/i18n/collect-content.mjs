// Собирает строки контента, автоматически переводит шаблонные, остальное выводит в .cache/content-manual.json
// Запуск: npm run i18n:collect (пакет content-model написан на TS, нужен tsx)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import YAML from 'yaml';
import { translatableEntries } from '@genshinflex/content-model';
import { createStore } from '../cms/store.mjs';

const root = new URL('../../', import.meta.url);
const store = createStore({ root: fileURLToPath(root) });
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const gen = (f) => JSON.parse(read(`src/data/generated/${f}`));
const ruChars = gen('characters.json'), enChars = gen('characters.en.json'), esChars = gen('characters.es.json');
const nameBy = (list) => new Map(list.map((c) => [c.slug, c.name]));
const slugByRu = new Map(ruChars.map((c) => [c.name, c.slug]));
const enName = nameBy(enChars), esName = nameBy(esChars);

const strings = new Set();
const add = (s) => { if (s && /[А-Яа-яЁё]/.test(s)) strings.add(s); };
for (const id of await store.listEntries('builds')) {
  const entry = await store.readEntry('builds', id);
  if (!entry) continue;
  const parsed = matter(entry.text, { engines: { yaml: (source) => YAML.parse(source) } });
  const data = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [
    key, value instanceof Date ? value.toISOString().slice(0, 10) : value,
  ]));
  for (const { path, value } of translatableEntries('builds', data)) {
    if (path === 'rotations[].steps') value.split(/\s*(?:→|->)\s*/).filter(Boolean).forEach(add);
    else add(value);
  }
}
for (const id of await store.listEntries('rotations')) {
  const entry = await store.readEntry('rotations', id);
  if (!entry) continue;
  // Строки этажей Бездны в словарь контента не собираются (как и раньше)
  translatableEntries('rotations', JSON.parse(entry.text)).filter(({ path }) => !path.startsWith('floors[]')).forEach(({ value }) => add(value));
}
// Сгенерированный текст разбора (шаблон)
add('Краткий билд по данным сообщества: роль — {role}, порядок вариантов — от лучшего к запасному. Подробный разбор ещё не написан.');

// Шаблонные: «Реакция (Персонаж)», «Команда Персонаж», типовые роли и заметки
const REACT = {
  'Обратное таяние': ['Reverse Melt', 'Derretido inverso'], 'Лунный заряд': ['Lunar-Charged', 'Electrocargado Lunar'],
  'Лунная бутонизация': ['Lunar-Bloom', 'Florecimiento Lunar'], 'Лунный кристалл': ['Lunar-Crystallize', 'Cristalización Lunar'],
  'Звёздное рассеивание': ['Stellar Swirl', 'Torbellino Estelar'], 'Звёздный проводник': ['Stellar-Conduct', 'Superconductor Estelar'],
  'Гиперцветение': ['Hyperbloom', 'Hyperbloom'], 'Квикбум': ['Quickbloom', 'Quickbloom'], 'Бутонизация': ['Burgeon', 'Burgeon'],
  'Цветение': ['Bloom', 'Florecimiento'], 'Пар': ['Vaporize', 'Vaporización'], 'Таяние': ['Melt', 'Derretido'], 'Заморозка': ['Freeze', 'Congelación'],
  'Обострение': ['Aggravate', 'Intensificación'], 'Разрастание': ['Spread', 'Propagación'], 'Катализ': ['Quicken', 'Aceleración'],
  'Заряд': ['Electro-Charged', 'Electrocargado'], 'Перегрузка': ['Overloaded', 'Sobrecarga'], 'Сверхпроводник': ['Superconduct', 'Superconductor'],
  'Горение': ['Burning', 'Quemadura'], 'Нацкоманда': ['National', 'National'], 'Гиперкэрри': ['Hypercarry', 'Hypercarry'],
  'Физ. урон': ['Physical', 'Físico'], 'Рассеивание': ['Swirl', 'Torbellino'], 'Кристаллизация': ['Crystallize', 'Cristalización'],
  'Двойное Гидро': ['Double Hydro', 'Doble Hydro'], 'Двойное Гео': ['Double Geo', 'Doble Geo'],
  'Моно-Гео': ['Mono Geo', 'Mono Geo'], 'Моно-Пиро': ['Mono Pyro', 'Mono Pyro'], 'Моно-Гидро': ['Mono Hydro', 'Mono Hydro'],
  'Моно-Электро': ['Mono Electro', 'Mono Electro'], 'Моно-Анемо': ['Mono Anemo', 'Mono Anemo'], 'Моно-Крио': ['Mono Cryo', 'Mono Cryo'], 'Моно-Дендро': ['Mono Dendro', 'Mono Dendro'],
};
const ROLE = { 'Главный ДД': ['Main DPS', 'DPS principal'], 'Саб-ДД': ['Sub DPS', 'DPS secundario'], 'Саппорт': ['Support', 'Apoyo'], 'ДД': ['DPS', 'DPS'] };
const NOTE = { '4 предмета': ['4-piece', '4 piezas'], '2 + 2': ['2 + 2', '2 + 2'] };

const auto = { en: {}, es: {} }, manual = [];
for (const s of strings) {
  let m;
  if (ROLE[s]) [auto.en[s], auto.es[s]] = ROLE[s];
  else if (NOTE[s]) [auto.en[s], auto.es[s]] = NOTE[s];
  else if ((m = s.match(/^(.+) \((.+)\)$/)) && REACT[m[1]] && slugByRu.has(m[2])) {
    const slug = slugByRu.get(m[2]);
    auto.en[s] = `${REACT[m[1]][0]} (${enName.get(slug)})`; auto.es[s] = `${REACT[m[1]][1]} (${esName.get(slug)})`;
  } else if ((m = s.match(/^Команда (.+)$/)) && slugByRu.has(m[1])) {
    const slug = slugByRu.get(m[1]);
    auto.en[s] = `${enName.get(slug)} team`; auto.es[s] = `Equipo de ${esName.get(slug)}`;
  } else manual.push(s);
}
writeFileSync(new URL('src/i18n/content-auto.json', root), JSON.stringify(auto, null, 1));
mkdirSync(new URL('.cache/', root), { recursive: true });
writeFileSync(new URL('.cache/content-manual.json', root), JSON.stringify(manual.sort(), null, 1));
console.log(`всего: ${strings.size}, автоматически: ${Object.keys(auto.en).length}, вручную: ${manual.length}`);

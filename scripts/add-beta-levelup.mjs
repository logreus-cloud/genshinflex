// Дописывает BETA-персонажей (src/data/beta-characters.json) в public/data/levelup.json для калькулятора прокачки.
// Запускается после import-levelup.mjs; повторный запуск ничего не дублирует.
// Расход материалов у всех персонажей одинаковый — берём стандартную схему, новые материалы получают свои id 99xxxx.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/data/levelup.json';
const data = JSON.parse(readFileSync(FILE, 'utf8'));
const beta = JSON.parse(readFileSync('src/data/beta-characters.json', 'utf8'));

const MORA = 202, CROWN = 104319;
// Самоцветы по стихии: осколок, фрагмент, кусок, камень
const GEMS = { electro: [104141, 104142, 104143, 104144] };

const NAMES = {
  weekly: ['Материал с еженедельного босса', 'Weekly boss material', 'Material de jefe semanal'],
  specialty: ['Местный диковинный материал', 'Local specialty', 'Especialidad local'],
  boss: ['Материал с босса', 'Boss material', 'Material de jefe'],
  books: [['Учения', 'Teachings', 'Enseñanzas'], ['Указания', 'Guide', 'Guía'], ['Философия', 'Philosophies', 'Filosofía']],
  common: [['Материал с монстров 1★', 'Common material 1★', 'Material común 1★'], ['Материал с монстров 2★', 'Common material 2★', 'Material común 2★'], ['Материал с монстров 3★', 'Common material 3★', 'Material común 3★']],
};
// Порядок сортировки как у настоящих материалов тех же типов
const SORT = { weekly: 11101, specialty: 317, boss: 11101, books: 13120, common: 10637 };

beta.characters.forEach((c, n) => {
  const gem = GEMS[c.element];
  if (!gem) throw new Error(`Нет самоцветов для стихии ${c.element} (${c.slug})`);
  const base = 990000 + (n + 1) * 100;
  const names = [c.i18n.ru.name, c.i18n.en.name, c.i18n.es.name];
  const mat = (id, rarity, key, label) => {
    data.materials[id] = {
      rarity, sort: SORT[key], icon: `/img/beta/${c.slug}-${key}.webp?v=2`,
      ru: `${label[0]} (${names[0]}, BETA)`, en: `${label[1]} (${names[1]}, BETA)`, es: `${label[2]} (${names[2]}, BETA)`,
    };
    return id;
  };
  const wk = mat(base + 1, 5, 'weekly', NAMES.weekly);
  const spec = mat(base + 2, 1, 'specialty', NAMES.specialty);
  const boss = mat(base + 3, 4, 'boss', NAMES.boss);
  const [b0, b1, b2] = NAMES.books.map((label, i) => mat(base + 4 + i, 2 + i, 'books', label));
  const [c0, c1, c2] = NAMES.common.map((label, i) => mat(base + 7 + i, 1 + i, 'common', label));
  const [g0, g1, g2, g3] = gem;
  data.characters[c.slug] = {
    asc: [
      [[MORA, 20000], [g0, 1], [spec, 3], [c0, 3]],
      [[MORA, 40000], [g1, 3], [boss, 2], [spec, 10], [c0, 15]],
      [[MORA, 60000], [g1, 6], [boss, 4], [spec, 20], [c1, 12]],
      [[MORA, 80000], [g2, 3], [boss, 8], [spec, 30], [c1, 18]],
      [[MORA, 100000], [g2, 6], [boss, 12], [spec, 45], [c2, 12]],
      [[MORA, 120000], [g3, 6], [boss, 20], [spec, 60], [c2, 24]],
    ],
    talents: [
      [[MORA, 12500], [b0, 3], [c0, 6]],
      [[MORA, 17500], [b1, 2], [c1, 3]],
      [[MORA, 25000], [b1, 4], [c1, 4]],
      [[MORA, 30000], [b1, 6], [c1, 6]],
      [[MORA, 37500], [b1, 9], [c1, 9]],
      [[MORA, 120000], [b2, 4], [c2, 4], [wk, 1]],
      [[MORA, 260000], [b2, 6], [c2, 6], [wk, 1]],
      [[MORA, 450000], [b2, 12], [c2, 9], [wk, 2]],
      [[MORA, 700000], [b2, 16], [c2, 12], [wk, 2], [CROWN, 1]],
    ],
  };
});

writeFileSync(FILE, JSON.stringify(data));
console.log(`калькулятор: BETA-персонажей ${beta.characters.length}`);

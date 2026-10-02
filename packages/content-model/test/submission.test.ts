import assert from 'node:assert/strict';
import test from 'node:test';
import matter from 'gray-matter';
import YAML from 'yaml';
import { fieldOrder } from '@genshinflex/content-model';
import { addAuthor, buildFromSubmission, guideFromSubmission } from '../../../scripts/guides/submission.mjs';
import { editorBuild, EXCLUDED_BUILD_FIELDS } from '../../../src/lib/editor-build';

const parse = (text: string) => matter(text, { engines: { yaml: (source) => YAML.parse(source) } }).data;
const previousText = `---
character: amber
role: ДД
updated: 2026-09-01
patch: "7.0"
weapons: []
artifacts: []
mainStats:
  sands: Сила атаки %
  goblet: Бонус Пиро урона
  circlet: Шанс крит. попадания
substats: []
talents: [skill]
teams: []
rotations:
  - name: Первая
    steps: Обычная атака
sources:
  - title: Источник
    url: https://example.com/source
external:
  - title: Старый гайд
    url: https://example.com/old
    lang: ru
authors: [Первый автор]
videos:
  - id: abcdefghijk
    title: Видео
    author: Автор видео
    lang: ru
---

Старый текст
`;
const g = {
  character: 'amber', role: '', patch: '', lang: 'ru',
  weapons: [{ slug: 'favonius-warbow', note: '' }],
  artifacts: [{ sets: ['noblesse-oblige'], note: '' }],
  mainStats: { sands: '', goblet: 'Бонус Пиро урона', circlet: 'Шанс крит. попадания' },
  substats: ['Сила атаки %'], talents: [], teams: [{ name: '', members: ['amber', 'lisa', 'kaeya', 'barbara'], note: '' }],
  body: 'Новый текст',
};

test('заявка сохраняет остальные поля билда и заменяет непустые ссылки', () => {
  const data = parse(buildFromSubmission({ g, previousText, author: 'Второй автор', today: '2026-10-02' }));
  const old = parse(previousText);
  for (const key of ['rotations', 'videos', 'sources', 'external']) assert.deepEqual(data[key], old[key]);
  assert.deepEqual(data.authors, ['Первый автор', 'Второй автор']);
  assert.deepEqual(data.talents, ['skill']);
  assert.equal(data.mainStats.sands, 'Любой');
  assert.equal(data.weapons[0].note, undefined);
  assert.equal(data.teams[0].name, 'Команда');

  const replacement = [{ title: 'Новый гайд', url: 'https://example.com/new', lang: 'en' }];
  const replaced = parse(buildFromSubmission({ g: { ...g, external: replacement }, previousText, author: 'Второй автор', today: '2026-10-02' }));
  assert.deepEqual(replaced.external, replacement);
});

test('frontmatter билда следует порядку полей модели', () => {
  const data = parse(buildFromSubmission({ g, previousText, author: 'Второй автор', today: '2026-10-02' }));
  assert.deepEqual(Object.keys(data), fieldOrder('builds'));
});

test('редактор получает каждое поле схемы билда', () => {
  const data = parse(previousText);
  const output = editorBuild({ ...data, updated: new Date('2026-09-01') }, 'Текст', {
    t: (value) => value, stat: (value) => value, lang: 'ru',
  });
  for (const key of fieldOrder('builds')) {
    if (!EXCLUDED_BUILD_FIELDS.includes(key)) assert.ok(Object.hasOwn(output, key), `Нет поля ${key}`);
  }
  assert.equal(output.rotations[0].steps, 'Обычная атака');
});

test('гайд сохраняет старые поля при приёме заявки', () => {
  const previous = '---\ncycle: 2026-09-01\nupdated: 2026-09-01\nauthors: [Первый автор]\nteams: []\nexternal:\n  - title: Старый гайд\n    url: https://example.com/old\n    lang: ru\ncustom: значение\n---\n\nСтарый текст\n';
  const data = parse(guideFromSubmission({
    g: { kind: 'endgame', cycle: '2026-10-02', teams: [], external: [], body: 'Новый текст' },
    previousText: previous, author: 'Второй автор', today: '2026-10-02',
  }));
  assert.equal(data.custom, 'значение');
  assert.equal(data.external[0].title, 'Старый гайд');
  assert.deepEqual(data.authors, ['Первый автор', 'Второй автор']);
});

test('добавление автора после заявки сохраняет корректный frontmatter и тело', () => {
  const submitted = buildFromSubmission({ g, previousText, author: 'Второй автор', today: '2026-10-02' });
  const updated = addAuthor({ previousText: submitted, author: 'Автор перевода' });
  assert.deepEqual(parse(updated).authors, ['Первый автор', 'Второй автор', 'Автор перевода']);
  assert.equal((updated.match(/^authors:/gm) ?? []).length, 1);
  assert.equal(matter(updated).content, matter(submitted).content);
});

test('добавление автора поддерживает однострочный список', () => {
  const previous = '---\nauthors: ["A"]\n---\n\nСтарый текст\n';
  const updated = addAuthor({ previousText: previous, author: 'B' });
  assert.deepEqual(parse(updated).authors, ['A', 'B']);
  assert.equal((updated.match(/^authors:/gm) ?? []).length, 1);
  assert.equal(matter(updated).content, matter(previous).content);
});

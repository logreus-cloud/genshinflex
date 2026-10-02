import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collections, documentId, entryId, entryIdFromId, fieldOrder, isDocumentId, localizedPaths, objectTypes, translatableStrings } from '../src/index.ts';

test('объектные типы совпадают с прежней картой', () => {
  const expected = {
    'build:weapons[]': 'weaponChoice',
    'build:artifacts[]': 'artifactChoice',
    'build:mainStats': 'mainStats',
    'build:teams[]': 'team',
    'build:rotations[]': 'buildRotation',
    'build:sources[]': 'source',
    'build:external[]': 'externalLink',
    'build:videos[]': 'video',
    'banner:featured[]': 'featuredCharacter',
    'banner:sources[]': 'source',
    'rotation:cast[]': 'rotationCast',
    'rotation:halves[]': 'rotationHalf',
    'rotation:halves[].need[]': 'elementGroup',
    'rotation:floors[]': 'rotationFloor',
    'rotation:floors[].chambers[]': 'rotationChamber',
    'rotation:floors[].chambers[].halves[]': 'rotationEnemyHalf',
    'rotation:floors[].chambers[].halves[].enemies[]': 'enemy',
    'rotation:floors[].teams[]': 'rotationTeam',
    'rotation:stages[]': 'rotationStage',
    'rotation:stages[].halves[]': 'rotationEnemyHalf',
    'rotation:stages[].halves[].enemies[]': 'enemyText',
    'rotation:teams[]': 'rotationTeam',
    'rotation:sources[]': 'source',
    'endgameGuide:teams[]': 'team',
    'endgameGuide:external[]': 'externalLink',
    'weaponGuide:external[]': 'externalLink',
  };
  // Схема допускает оба типа врага в обоих местах; этажи сохраняют прежний тип enemy.
  const types = new Set(Object.values(collections).map(({ type }) => type));
  const actual = Object.assign({}, ...Array.from(types, (type) => objectTypes(type)));
  assert.deepEqual(actual, expected);
});

test('локализуемые пути совпадают с прежней картой', () => {
  const expected = [
    'rotation:note',
    'rotation:tags[]',
    'rotation:buffs[]',
    'rotation:cast[].title',
    'rotation:halves[].label',
    'rotation:halves[].tip',
    'rotation:floors[].disorder[]',
    'rotation:floors[].chambers[].name',
    'rotation:floors[].chambers[].halves[].note',
    'rotation:floors[].chambers[].halves[].enemies[].note',
    'rotation:floors[].teams[].name',
    'rotation:floors[].teams[].note',
    'rotation:stages[].name',
    'rotation:stages[].halves[].note',
    'rotation:stages[].halves[].enemies[].note',
    'rotation:teams[].name',
    'rotation:teams[].note',
  ];
  const actual = [...new Set(Object.values(collections).flatMap(({ type }) => [...localizedPaths(type)]))];
  assert.deepEqual(actual.sort(), expected.sort());
});

test('порядок полей сохраняет прежний Markdown', () => {
  const expected = {
    builds: ['character', 'role', 'updated', 'patch', 'weapons', 'artifacts', 'mainStats', 'substats', 'talents', 'teams', 'rotations', 'sources', 'external', 'authors', 'videos'],
    buildsI18n: [],
    rotations: [],
    banners: [],
    news: ['lang', 'anchor', 'title', 'summary', 'date', 'draft'],
    weaponGuides: ['updated', 'authors', 'external'],
    endgameGuides: ['cycle', 'updated', 'teams', 'authors', 'external'],
  };
  assert.deepEqual(Object.fromEntries(Object.keys(collections).map((collection) => [
    collection, fieldOrder(collection as keyof typeof collections),
  ])), expected);
});

test('id документа и записи образуют круг для каждой коллекции', () => {
  const entries = {
    builds: ['albedo', 'build.ru.albedo', { character: 'albedo', lang: 'ru' }],
    buildsI18n: ['en/albedo', 'build.en.albedo', { character: 'albedo', lang: 'en' }],
    rotations: ['abyss-1', 'rotation.abyss-1', { slug: { current: 'abyss-1' } }],
    banners: ['banner-1', 'banner.banner-1', { slug: { current: 'banner-1' } }],
    news: ['ru/news-1', 'news.ru.news-1', { lang: 'ru', slug: { current: 'news-1' } }],
    weaponGuides: ['en/sword-1', 'weaponGuide.en.sword-1', { lang: 'en', slug: 'sword-1' }],
    endgameGuides: ['es/cycle-1', 'endgameGuide.es.cycle-1', { lang: 'es', slug: 'cycle-1' }],
  } as const;
  for (const collection of Object.keys(collections) as (keyof typeof collections)[]) {
    const [id, expected, fields] = entries[collection];
    const _id = documentId(collection, id);
    assert.equal(_id, expected);
    assert.equal(entryId(collection, { _id, ...fields }), id);
    assert.equal(isDocumentId(collection, _id), true);
    assert.equal(entryIdFromId(collection, _id), id);
  }
});

test('неверный id записи сохраняет прежнюю ошибку', () => {
  assert.throws(() => entryId('news', { _id: 'news.ru.bad', lang: 'ru', slug: 'bad/name' }), /Sanity: неверный id в коллекции news, документ news\.ru\.bad/);
});

test('строки билда берутся из отмеченных полей схемы', () => {
  const data = {
    role: 'Главный ДД',
    weapons: [{ slug: 'sword', note: 'Оружие' }],
    artifacts: [{ sets: ['set'], note: 'Артефакты' }],
    teams: [{ name: 'Команда', members: ['a', 'b', 'c', 'd'], note: 'Примечание' }],
    rotations: [{ name: 'Цикл', steps: 'Навык → Взрыв', note: 'Ротация' }],
    sources: [{ title: 'Источник' }],
  };
  assert.deepEqual(translatableStrings('builds', data).sort(), [
    'Главный ДД', 'Оружие', 'Артефакты', 'Команда', 'Примечание', 'Цикл', 'Навык → Взрыв', 'Ротация',
  ].sort());
  assert.deepEqual(translatableStrings('endgameGuides', data), []);
});

test('строки ротации учитывают localeString (в том числе этажи) и строковых врагов', () => {
  const data = {
    cycle: 'Цикл',
    note: 'Примечание',
    tags: ['Метка'],
    buffs: ['Бонус'],
    stages: [{ name: 'Этап', halves: [{ enemies: ['Враг'], note: 'Половина' }] }],
    cast: [{ title: 'Состав' }],
    teams: [{ name: 'Команда', note: 'Совет' }],
    halves: [{ label: 'Первая половина', tip: 'Подсказка', need: [['pyro']] }],
    floors: [{ chambers: [{ name: 'Зал' }] }],
  };
  assert.deepEqual(translatableStrings('rotations', data).sort(), [
    'Цикл', 'Примечание', 'Метка', 'Бонус', 'Этап', 'Враг', 'Половина',
    'Состав', 'Команда', 'Совет', 'Первая половина', 'Подсказка', 'Зал',
  ].sort());
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentSchemas } from '../../../src/lib/content-schemas.ts';
import { collections, compiledType, type Collection, type Shape } from '../src/index.ts';

type ZodNode = {
  _def: {
    type?: string;
    typeName?: string;
    innerType?: ZodNode;
    in?: ZodNode;
    out?: ZodNode;
    schema?: ZodNode;
  };
  shape?: Record<string, ZodNode>;
  element?: ZodNode;
  options?: readonly ZodNode[];
};

function zodPaths(node: ZodNode, path = '', paths = new Set<string>()): Set<string> {
  if (path) paths.add(path);
  const kind = node._def.type ?? node._def.typeName;
  if (['optional', 'default', 'nullable', 'pipe', 'coerce', 'ZodOptional', 'ZodDefault', 'ZodNullable', 'ZodPipeline', 'ZodEffects'].includes(kind ?? '')) {
    const inner = node._def.innerType ?? node._def.in ?? node._def.schema ?? node._def.out;
    assert.ok(inner, `Не удалось раскрыть zod-схему по пути ${path}`);
    return zodPaths(inner, path, paths);
  }
  if (kind === 'array' || kind === 'ZodArray') {
    assert.ok(node.element, `Не найден элемент zod-массива ${path}`);
    zodPaths(node.element, `${path}[]`, paths);
  } else if (kind === 'object' || kind === 'ZodObject') {
    for (const [field, value] of Object.entries(node.shape ?? {})) zodPaths(value, path ? `${path}.${field}` : field, paths);
  } else if (kind === 'union' || kind === 'ZodUnion') {
    for (const option of node.options ?? []) zodPaths(option, path, paths);
  }
  return paths;
}

function sanityPaths(node: Shape, path = '', paths = new Set<string>()): Set<string> {
  if (path) paths.add(path);
  if (node.name === 'localeString') return paths;
  if (node.jsonType === 'array') {
    for (const member of node.of ?? []) sanityPaths(member, `${path}[]`, paths);
  } else if (node.jsonType === 'object' && node.name !== 'slug') {
    for (const field of node.fields ?? []) sanityPaths(field.type, path ? `${path}.${field.name}` : field.name, paths);
  }
  return paths;
}

type Exception = { collection: Collection; path: string; reason: string };
const translatedBuild = 'Перевод билда хранит только текст; структурные поля принадлежат русскому билду.';
const markdownBody = 'Markdown и Portable Text сохраняются отдельно от полей коллекции.';
const sanityOnly: Exception[] = [
  { collection: 'builds', path: 'lang', reason: 'Язык русского билда хранится только в Sanity.' },
  { collection: 'builds', path: 'body', reason: markdownBody },
  { collection: 'builds', path: 'bodyMarkdown', reason: markdownBody },
  { collection: 'builds', path: 'bodyHash', reason: markdownBody },

  { collection: 'buildsI18n', path: 'lang', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'character', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'role', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'updated', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'patch', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'weapons', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'artifacts', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'mainStats', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'substats', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'talents', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'teams', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'rotations', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'sources', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'external', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'authors', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'videos', reason: translatedBuild },
  { collection: 'buildsI18n', path: 'body', reason: markdownBody },
  { collection: 'buildsI18n', path: 'bodyMarkdown', reason: markdownBody },
  { collection: 'buildsI18n', path: 'bodyHash', reason: markdownBody },

  { collection: 'rotations', path: 'slug', reason: 'Слаг файла хранится только в Sanity.' },
  { collection: 'rotations', path: 'halves[].need[].elements', reason: 'cms-mapping.ts превращает массив стихий в elementGroup.' },
  { collection: 'rotations', path: 'floors[].chambers[].halves[].enemies[].name', reason: 'cms-mapping.ts превращает строкового врага в enemyText.' },
  { collection: 'rotations', path: 'stages[].halves[].enemies[].name', reason: 'cms-mapping.ts превращает строкового врага в enemyText.' },
  { collection: 'rotations', path: 'stages[].halves[].enemies[].id', reason: 'Sanity допускает enemy наряду с enemyText; zod этапа хранит строки.' },
  { collection: 'rotations', path: 'stages[].halves[].enemies[].n', reason: 'Sanity допускает enemy наряду с enemyText; zod этапа хранит строки.' },
  { collection: 'rotations', path: 'stages[].halves[].enemies[].note', reason: 'Sanity допускает enemy наряду с enemyText; zod этапа хранит строки.' },

  { collection: 'banners', path: 'slug', reason: 'Слаг файла хранится только в Sanity.' },

  { collection: 'news', path: 'slug', reason: 'Слаг файла хранится только в Sanity.' },
  { collection: 'news', path: 'dateTime', reason: 'cms-mapping.ts сохраняет исходное время отдельно от даты.' },
  { collection: 'news', path: 'body', reason: markdownBody },
  { collection: 'news', path: 'bodyMarkdown', reason: markdownBody },
  { collection: 'news', path: 'bodyHash', reason: markdownBody },

  { collection: 'weaponGuides', path: 'lang', reason: 'Язык берётся из id записи.' },
  { collection: 'weaponGuides', path: 'slug', reason: 'Слаг берётся из id записи.' },
  { collection: 'weaponGuides', path: 'body', reason: markdownBody },
  { collection: 'weaponGuides', path: 'bodyMarkdown', reason: markdownBody },
  { collection: 'weaponGuides', path: 'bodyHash', reason: markdownBody },

  { collection: 'endgameGuides', path: 'lang', reason: 'Язык берётся из id записи.' },
  { collection: 'endgameGuides', path: 'slug', reason: 'Слаг берётся из id записи.' },
  { collection: 'endgameGuides', path: 'body', reason: markdownBody },
  { collection: 'endgameGuides', path: 'bodyMarkdown', reason: markdownBody },
  { collection: 'endgameGuides', path: 'bodyHash', reason: markdownBody },
];

const zodOnly: Exception[] = [
  { collection: 'rotations', path: 'halves[].need[][]', reason: 'cms-mapping.ts превращает вложенный массив стихий в elementGroup.elements.' },
];

// Служебные поля документов и элементов массива создаёт Sanity.
const sanityMetadata = new Set(['_id', '_type', '_rev', '_createdAt', '_updatedAt', '_key']);

function excepted(exceptions: Exception[], collection: Collection, path: string): boolean {
  return exceptions.some((exception) =>
    exception.collection === collection && (path === exception.path || path.startsWith(`${exception.path}.`) || path.startsWith(`${exception.path}[]`)));
}

for (const collection of Object.keys(collections) as Collection[]) {
  test(`контракт схем коллекции ${collection}`, () => {
    const zod = zodPaths(contentSchemas[collection] as unknown as ZodNode);
    const sanity = sanityPaths(compiledType(collection));
    for (const exception of sanityOnly.filter((item) => item.collection === collection)) {
      assert.ok(sanity.has(exception.path) && !zod.has(exception.path),
        `${collection}: устаревшее исключение ${exception.path}: ${exception.reason}`);
    }
    for (const exception of zodOnly.filter((item) => item.collection === collection)) {
      assert.ok(zod.has(exception.path) && !sanity.has(exception.path),
        `${collection}: устаревшее исключение ${exception.path}: ${exception.reason}`);
    }
    const missing: string[] = [];
    for (const path of zod) {
      if (!sanity.has(path) && !excepted(zodOnly, collection, path)) missing.push(`${collection}: ${path} отсутствует в Sanity`);
    }
    for (const path of sanity) {
      if (sanityMetadata.has(path.split('.').at(-1)!)) continue;
      if (!zod.has(path) && !excepted(sanityOnly, collection, path)) missing.push(`${collection}: ${path} отсутствует в zod`);
    }
    assert.deepEqual(missing, [], missing.join('\n'));
  });
}

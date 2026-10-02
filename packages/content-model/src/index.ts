import { Schema } from '@sanity/schema';
import { builtinTypes } from '@sanity/schema/_internal';
import { schemaTypes } from '../../../apps/studio/schemas/index.ts';

export type Collection = 'builds' | 'buildsI18n' | 'rotations' | 'banners' | 'news' | 'weaponGuides' | 'endgameGuides';
type Document = { _id: string; lang?: string; character?: string; slug?: string | { current?: string } };
export type Shape = { name?: string; jsonType?: string; options?: { translate?: boolean }; fields?: { name: string; type: Shape; options?: { translate?: boolean } }[]; of?: Shape[] };

export const collections: Record<Collection, { folder: string; type: string; extension: string }> = {
  builds: { folder: 'builds', type: 'build', extension: '.md' },
  buildsI18n: { folder: 'builds-i18n', type: 'build', extension: '.md' },
  rotations: { folder: 'rotations', type: 'rotation', extension: '.json' },
  banners: { folder: 'banners', type: 'banner', extension: '.json' },
  news: { folder: 'news', type: 'news', extension: '.md' },
  weaponGuides: { folder: 'weapon-guides', type: 'weaponGuide', extension: '.md' },
  endgameGuides: { folder: 'endgame-guides', type: 'endgameGuide', extension: '.md' },
};

// Встроенные типы Sanity (slug, image…) нужны, чтобы поля с ними разрешались при обходе
const schema = Schema.compile({ name: 'migration', types: [...builtinTypes, ...schemaTypes] });
const models = new Map<string, { objects: Record<string, string>; localized: Set<string>; translatable: Set<string> }>();
// htmlToBlocks ждёт тип-массив (поле body), а не сам тип блока
export const buildBodyType = (schema.get('build') as { fields: { name: string; type: unknown }[] }).fields.find((field) => field.name === 'body')!.type;

export function compiledType(collection: Collection): Shape {
  return schema.get(collections[collection].type) as unknown as Shape;
}

export function documentId(collection: Collection, id: string): string {
  const name = id.split('/').at(-1);
  const lang = collection === 'builds' ? 'ru' : id.includes('/') ? id.split('/')[0] : 'ru';
  const prefix = ['builds', 'buildsI18n', 'news', 'weaponGuides', 'endgameGuides'].includes(collection) ? `${lang}.` : '';
  return `${collections[collection].type}.${prefix}${name}`;
}

export function entryId(collection: Collection, document: Document): string {
  const slug = typeof document.slug === 'string' ? document.slug : document.slug?.current;
  const part = collection === 'builds' || collection === 'buildsI18n' ? document.character : slug;
  const parts = collection === 'builds' || collection === 'rotations' || collection === 'banners'
    ? [part]
    : [document.lang, part];
  if (parts.some((value) => typeof value !== 'string' || !value.trim() || value.includes('/'))) {
    throw new Error(`Sanity: неверный id в коллекции ${collection}, документ ${document._id}`);
  }
  return parts.join('/');
}

export function isDocumentId(collection: Collection, id: string): boolean {
  if (collection === 'builds') return id.startsWith('build.ru.');
  if (collection === 'buildsI18n') return /^build\.(en|es)\./.test(id);
  return id.startsWith(`${collections[collection].type}.`);
}

export function entryIdFromId(collection: Collection, id: string): string {
  const parts = id.split('.');
  return ['buildsI18n', 'news', 'weaponGuides', 'endgameGuides'].includes(collection)
    ? `${parts[1]}/${parts.slice(2).join('.')}` : parts.slice(collection === 'builds' ? 2 : 1).join('.');
}

function model(type: string) {
  const saved = models.get(type);
  if (saved) return saved;
  const objects: Record<string, string> = {};
  const localized = new Set<string>();
  const translatable = new Set<string>();
  function visit(value: Shape, path: string) {
    if (value.name === 'localeString') {
      localized.add(`${type}:${path}`);
      translatable.add(path);
      return;
    }
    if (value.options?.translate && value.jsonType === 'string') translatable.add(path);
    if (value.jsonType === 'array') {
      for (const member of value.of ?? []) visit(member, `${path}[]`);
      return;
    }
    if (value.jsonType !== 'object' || value.name === 'slug') return;
    if (path && value.name && value.name !== 'object') objects[`${type}:${path}`] ??= value.name;
    for (const field of value.fields ?? []) {
      const fieldPath = path ? `${path}.${field.name}` : field.name;
      if (field.options?.translate && field.type.jsonType === 'string') translatable.add(fieldPath);
      if (field.name !== 'body') visit(field.type, fieldPath);
    }
  }
  visit(schema.get(type) as unknown as Shape, '');
  // Схема допускает enemy и enemyText в обоих массивах; для этажей прежний выбор — enemy.
  if (type === 'rotation') objects['rotation:floors[].chambers[].halves[].enemies[]'] = 'enemy';
  const result = { objects, localized, translatable };
  models.set(type, result);
  return result;
}

export function objectTypes(type: string): Record<string, string> {
  return model(type).objects;
}

export function isLocalized(type: string, path: string): boolean {
  return model(type).localized.has(`${type}:${path}`);
}

export function localizedPaths(type: string): Set<string> {
  return model(type).localized;
}

function valuesAt(value: unknown, parts: string[]): unknown[] {
  if (!parts.length) return [value];
  const [part, ...rest] = parts;
  const array = part.endsWith('[]');
  const field = array ? part.slice(0, -2) : part;
  const next = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[field] : undefined;
  return array ? Array.isArray(next) ? next.flatMap((item) => valuesAt(item, rest)) : [] : valuesAt(next, rest);
}

export function translatableEntries(collection: Collection, data: unknown): { path: string; value: string }[] {
  if (collection !== 'builds' && collection !== 'rotations') return [];
  const type = collections[collection].type;
  const result: { path: string; value: string }[] = [];
  for (const path of model(type).translatable) {
    const enemyName = path.endsWith('.enemies[].name');
    const source = enemyName ? path.slice(0, -'.name'.length) : path;
    for (const item of valuesAt(data, source.split('.'))) {
      const value = enemyName && item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>).name : item;
      if (typeof value === 'string') result.push({ path, value });
    }
  }
  return result;
}

export function translatableStrings(collection: Collection, data: unknown): string[] {
  return translatableEntries(collection, data).map(({ value }) => value);
}


export function fieldOrder(collection: Collection): string[] {
  if (collection === 'buildsI18n' || collections[collection].extension === '.json') return [];
  const excluded = new Set(['body', 'bodyMarkdown', 'bodyHash', 'dateTime', 'slug']);
  if (['builds', 'weaponGuides', 'endgameGuides'].includes(collection)) excluded.add('lang');
  // image раньше записывался после упорядоченных полей новости.
  if (collection === 'news') excluded.add('image');
  const type = schema.get(collections[collection].type) as { fields: { name: string }[] };
  return type.fields.map((field) => field.name).filter((name) => !excluded.has(name));
}

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import { marked } from 'marked';
import { JSDOM } from 'jsdom';
import { htmlToBlocks } from '@portabletext/block-tools';
import { Schema } from '@sanity/schema';
import { schemaTypes } from '../../apps/studio/schemas/index.ts';
import { bodyHash, fromSanityData, toSanityData } from '../../src/lib/cms-mapping.ts';
import { portableTextToMarkdown } from '../../src/lib/portable-text-md.ts';

export { fromSanityData, portableTextToMarkdown };

const schema = Schema.compile({ name: 'migration', types: schemaTypes });
// htmlToBlocks ждёт тип-массив (поле body), а не сам тип блока
const blockType = schema.get('build').fields.find((field) => field.name === 'body').type;
const folders = {
  builds: 'builds',
  buildsI18n: 'builds-i18n',
  rotations: 'rotations',
  banners: 'banners',
  news: 'news',
  weaponGuides: 'weapon-guides',
  endgameGuides: 'endgame-guides',
};
const types = {
  builds: 'build',
  buildsI18n: 'build',
  rotations: 'rotation',
  banners: 'banner',
  news: 'news',
  weaponGuides: 'weaponGuide',
  endgameGuides: 'endgameGuide',
};

async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const paths = await Promise.all(entries.map((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return paths.flat().sort();
}

export async function files() {
  const result = [];
  for (const [collection, folder] of Object.entries(folders)) {
    const base = join('src', 'content', folder);
    for (const path of await walk(base)) {
      if (!['.md', '.json'].includes(extname(path))) continue;
      result.push({ collection, path, id: relative(base, path).replaceAll('\\', '/').replace(/\.(md|json)$/, '') });
    }
  }
  return result;
}

export async function readContent(file) {
  const source = await readFile(file.path, 'utf8');
  if (file.path.endsWith('.json')) return { data: JSON.parse(source), body: undefined };
  const parsed = matter(source, { engines: { yaml: (text) => YAML.parse(text) } });
  const data = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [
    key, value instanceof Date ? value.toISOString().slice(0, 10) : value,
  ]));
  return { data, body: parsed.content };
}

export function markdownToPortableText(markdown, path) {
  const tokens = marked.lexer(markdown);
  marked.walkTokens(tokens, (token) => {
    if (['table', 'html', 'image', 'code', 'hr'].includes(token.type)) {
      throw new Error(`${path}: Markdown-конструкция ${token.type} не поддерживается Portable Text`);
    }
    if (token.type === 'heading' && ![2, 3, 4].includes(token.depth)) {
      throw new Error(`${path}: заголовок h${token.depth} не поддерживается Portable Text`);
    }
  });
  // breaks: сайт (renderGuide) показывает перенос строки внутри абзаца как <br> — сохраняем его как «\n» в тексте блока
  const html = marked.parse(markdown, { breaks: true });
  try {
    let key = 0;
    return htmlToBlocks(html, blockType, {
      parseHtml: (input) => new JSDOM(input).window.document,
      keyGenerator: () => String(key++),
    });
  } catch (error) {
    throw new Error(`${path}: не удалось преобразовать Markdown: ${String(error)}`);
  }
}

export function toDocument(file, data, body) {
  const type = types[file.collection];
  const name = basename(file.id);
  const lang = file.id.includes('/') ? file.id.split('/')[0] : 'ru';
  const document = { _id: '', _type: type, ...toSanityData(type, data) };
  if (file.collection === 'builds') Object.assign(document, { _id: `build.ru.${name}`, lang: 'ru' });
  if (file.collection === 'buildsI18n') Object.assign(document, { _id: `build.${lang}.${name}`, lang, character: name });
  if (file.collection === 'news') Object.assign(document, { _id: `news.${lang}.${name}`, lang, slug: { _type: 'slug', current: name } });
  if (file.collection === 'rotations') Object.assign(document, { _id: `rotation.${name}`, slug: { _type: 'slug', current: name } });
  if (file.collection === 'banners') Object.assign(document, { _id: `banner.${name}`, slug: { _type: 'slug', current: name } });
  if (file.collection === 'weaponGuides' || file.collection === 'endgameGuides') {
    Object.assign(document, { _id: `${type}.${lang}.${name}`, lang, slug: name });
  }
  if (body !== undefined) {
    document.body = markdownToPortableText(body, file.path);
    document.bodyMarkdown = body;
    document.bodyHash = bodyHash(document.body);
  }
  return document;
}

export function fromDocument(file, document) {
  return file.collection === 'buildsI18n' ? {} : fromSanityData(types[file.collection], document);
}

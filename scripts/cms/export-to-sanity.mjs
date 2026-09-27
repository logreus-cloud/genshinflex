import { mkdir, writeFile } from 'node:fs/promises';
import { files, readContent, toDocument } from './mapping.mjs';

const documents = [];
const counts = {};
const groups = new Map();

for (const file of await files()) {
  const { data, body } = await readContent(file);
  const document = toDocument(file, data, body);
  documents.push(document);
  counts[document._type] = (counts[document._type] ?? 0) + 1;
  if (!['build', 'news', 'weaponGuide', 'endgameGuide'].includes(document._type)) continue;
  // Переводы новости связывает общий anchor; slug в Sanity — объект { current }
  const slug = document._type === 'build' ? document.character
    : document._type === 'news' ? document.anchor
    : typeof document.slug === 'string' ? document.slug : document.slug?.current;
  if (!slug) throw new Error(`${document._id}: не удалось определить, к какой группе переводов он относится`);
  if (groups.get(`${document._type}.${slug}`)?.has(document.lang)) {
    throw new Error(`${document._id}: второй документ языка ${document.lang} в группе ${document._type}.${slug}`);
  }
  const key = `${document._type}.${slug}`;
  if (!groups.has(key)) groups.set(key, new Map());
  groups.get(key).set(document.lang, document._id);
}

let translations = 0;
for (const [key, languages] of groups) {
  if (languages.size < 2) continue;
  const [type] = key.split('.');
  documents.push({
    _id: `translation.metadata.${key}`,
    _type: 'translation.metadata',
    schemaTypes: [type],
    translations: [...languages].sort(([a], [b]) => a.localeCompare(b)).map(([lang, id]) => ({
      _key: lang,
      value: { _type: 'reference', _ref: id, _weak: true },
    })),
  });
  translations++;
}

documents.sort((a, b) => a._id.localeCompare(b._id));
await mkdir('.cache', { recursive: true });
await writeFile('.cache/sanity-import.ndjson', documents.map((document) => JSON.stringify(document)).join('\n') + '\n');
for (const [type, count] of Object.entries(counts).sort()) console.log(`${type}: ${count}`);
console.log(`Связок переводов: ${translations}`);
console.log(`Всего документов: ${documents.length}`);
console.log('Предупреждения: 0');

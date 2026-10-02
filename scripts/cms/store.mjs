import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@sanity/client';
import { collections, documentId, entryIdFromId, fieldOrder, isDocumentId } from '@genshinflex/content-model';
import matter from 'gray-matter';
import YAML from 'yaml';
import { bodyHash, contentHash } from '../../src/lib/cms-mapping.ts';
import { fromDocument, portableTextToMarkdown, toDocument } from './mapping.mjs';

function entry(collection, id, root) {
  const config = collections[collection];
  if (!config || !id || id.split('/').some((part) => !part || part === '.' || part === '..') || id.includes('\\'))
    throw new Error(`Недопустимый контент: ${collection}/${id}`);
  const path = join(root, 'src', 'content', config.folder, `${id}${config.extension}`);
  return { collection, id, path, ...config };
}

function parseText(file, text) {
  if (file.extension === '.json') return { data: JSON.parse(text), body: undefined };
  const parsed = matter(text, { engines: { yaml: (source) => YAML.parse(source) } });
  const data = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [
    key, value instanceof Date ? value.toISOString().slice(0, 10) : value,
  ]));
  return { data, body: parsed.content };
}

function renderText(file, document) {
  const data = fromDocument(file, document);
  if (file.extension === '.json') return `${JSON.stringify(data, null, 2)}\n`;
  const order = fieldOrder(file.collection);
  const ordered = Object.fromEntries([
    ...order.filter((key) => key in data).map((key) => [key, data[key]]),
    ...Object.entries(data).filter(([key]) => !order.includes(key)),
  ]);
  const yaml = Object.keys(ordered).length ? YAML.stringify(ordered).trimEnd() + '\n' : '';
  const body = document.bodyHash === bodyHash(document.body) && typeof document.bodyMarkdown === 'string'
    ? document.bodyMarkdown : portableTextToMarkdown(document.body ?? []);
  // bodyMarkdown — тело из gray-matter, уже начинается с «\n»: второй перенос копился бы при каждом круге чтение → запись
  const text = body.startsWith('\n') ? body : `\n${body}`;
  return `---\n${yaml}---\n${text.endsWith('\n') ? text : `${text}\n`}`;
}

function translation(document) {
  if (!['build', 'news', 'weaponGuide', 'endgameGuide'].includes(document._type)) return null;
  const slug = document._type === 'build' ? document.character
    : document._type === 'news' ? document.anchor
    : typeof document.slug === 'string' ? document.slug : document.slug?.current;
  if (!slug) throw new Error(`${document._id}: не удалось определить группу переводов`);
  return { id: `translation.metadata.${document._type}.${slug}`, lang: document.lang };
}

export function createStore({ client, root = process.cwd(), source } = {}) {
  if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  const mode = source ?? (process.env.CONTENT_SOURCE === 'sanity' ? 'sanity' : 'files');
  const clients = new Map();

  const getClient = (writing = false) => {
    if (client) return client;
    const token = writing ? process.env.SANITY_WRITE_TOKEN : process.env.SANITY_READ_TOKEN || process.env.SANITY_WRITE_TOKEN;
    if (!token) throw new Error(writing ? 'Для записи нужен токен Editor в .env как SANITY_WRITE_TOKEN' : 'Для чтения Sanity нужен SANITY_READ_TOKEN или SANITY_WRITE_TOKEN в .env');
    const key = writing ? 'write' : 'read';
    if (!clients.has(key)) clients.set(key, createClient({
      projectId: '6qrew4ya', dataset: 'production', apiVersion: '2025-02-19',
      useCdn: false, perspective: 'published', token,
    }));
    return clients.get(key);
  };

  async function readEntry(collection, id) {
    const file = entry(collection, id, root);
    if (mode === 'files') {
      try { return { text: await readFile(file.path, 'utf8'), rev: null, studioEdited: false }; }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }
    const document = await getClient().fetch('*[_id == $id][0]', { id: documentId(file.collection, file.id) });
    return document ? {
      text: renderText(file, document),
      rev: document._rev,
      studioEdited: !document.syncHash || contentHash(document) !== document.syncHash,
    } : null;
  }

  async function listEntries(collection) {
    const file = entry(collection, 'placeholder', root);
    if (mode === 'files') {
      const base = join(root, 'src', 'content', file.folder);
      async function walk(folder, prefix = '') {
        let names;
        try { names = await readdir(folder, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
        const items = await Promise.all(names.map(async (item) => {
          const id = `${prefix}${item.name}`;
          if (item.isDirectory()) return walk(join(folder, item.name), `${id}/`);
          return id.endsWith(file.extension) ? [id.slice(0, -file.extension.length)] : [];
        }));
        return items.flat();
      }
      return (await walk(base)).sort();
    }
    const ids = await getClient().fetch('*[_type == $type]._id', { type: file.type });
    return ids.filter((id) => isDocumentId(collection, id))
      .map((id) => entryIdFromId(collection, id))
      .sort();
  }

  async function writeEntry(collection, id, text, { ifRevision, mustNotExist = false } = {}) {
    const file = entry(collection, id, root);
    if (mode === 'files') {
      await mkdir(join(file.path, '..'), { recursive: true });
      await writeFile(file.path, text);
      return null;
    }
    const api = getClient(true);
    const { data, body } = parseText(file, text);
    const document = toDocument(file, data, body);
    document.syncHash = contentHash(document);
    const draft = await api.fetch('*[_id == $id][0]._id', { id: `drafts.${document._id}` }, { perspective: 'raw' });
    if (draft) console.warn(`В Studio есть неопубликованный черновик: ${document._id}; при публикации он перезапишет эту запись`);

    const group = translation(document);
    const metadata = group ? await api.fetch('*[_id == $id][0]', { id: group.id }) : null;
    const tx = api.transaction();
    // Условие ревизии — через конструктор patch(): объект { ifRevisionID } в tx.patch клиент молча отбрасывает
    if (ifRevision) {
      tx.patch(api.patch(document._id).ifRevisionId(ifRevision)
        .set(Object.fromEntries(Object.entries(document).filter(([key]) => !key.startsWith('_')))));
    }
    if (mustNotExist) tx.create(document);
    else tx.createOrReplace(document);
    if (group) {
      tx.createIfNotExists({
        _id: group.id, _type: 'translation.metadata', schemaTypes: [document._type], translations: [],
      });
      const reference = { _type: 'reference', _ref: document._id, _weak: true };
      if (metadata?.translations?.some((item) => item._key === group.lang)) {
        tx.patch(group.id, { set: { [`translations[_key=="${group.lang}"].value`]: reference } });
      } else {
        tx.patch(group.id, {
          setIfMissing: { translations: [] },
          insert: { after: 'translations[-1]', items: [{ _key: group.lang, value: reference }] },
        });
      }
    }
    let result;
    try { result = await tx.commit({ returnDocuments: true }); }
    catch (error) {
      if (ifRevision && /revision|conflict|precondition/i.test(String(error))) {
        throw new Error(`${document._id}: документ изменён в Studio, перезапустите`, { cause: error });
      }
      if (mustNotExist && /already exists|already exist|conflict/i.test(String(error))) {
        throw new Error(`${document._id}: документ появился в Studio, перезапустите`, { cause: error });
      }
      throw error;
    }
    // С returnDocuments клиент возвращает массив документов после транзакции (проверено вживую); берём последнюю версию нашего
    const returned = Array.isArray(result) ? result : (result.results ?? []).map((item) => item.document);
    const rev = returned.findLast((item) => item?._id === document._id)?._rev;
    if (!rev) throw new Error(`${document._id}: ответ Sanity не содержит ревизию записанного документа`);
    return rev;
  }

  return { mode, readEntry, listEntries, writeEntry };
}

export const store = createStore();
export const mode = store.mode;

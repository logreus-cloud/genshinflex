import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import { contentHash } from '../../src/lib/cms-mapping.ts';
import { createStore } from './store.mjs';
import { toDocument } from './mapping.mjs';

const build = `---
character: albedo
role: "Саб-ДД"
updated: 2026-09-24
patch: "7.1"
weapons: []
artifacts: []
mainStats: {sands: "Защита %", goblet: "Гео", circlet: "Крит"}
substats: []
teams: []
---

Текст билда.
`;

function fakeClient() {
  const documents = new Map();
  const mutations = [];
  const client = {
    commits: [],
    documents, mutations,
    async fetch(query, { id, type } = {}) {
      if (query.includes('._id')) return documents.get(id)?._id ?? null;
      if (query.includes('._rev')) return documents.get(id)?._rev ?? null;
      if (type) return [...documents.values()].filter((doc) => doc._type === type).map((doc) => doc._id);
      return documents.get(id) ?? null;
    },
    // Конструктор patch() как у @sanity/client: условие ревизии задаётся через ifRevisionId()
    patch(id) {
      const ops = {};
      const builder = { id, ops, ifRevisionId(rev) { ops.ifRevisionID = rev; return builder; }, set(value) { ops.set = value; return builder; } };
      return builder;
    },
    transaction() {
      const changes = [];
      const tx = {
        patch(id, patch) {
          if (typeof id === 'object') changes.push({ kind: 'patch', id: id.id, patch: id.ops });
          else changes.push({ kind: 'patch', id, patch });
          return tx;
        },
        create(document) { changes.push({ kind: 'createOnly', document }); return tx; },
        createOrReplace(document) { changes.push({ kind: 'replace', document }); return tx; },
        createIfNotExists(document) { changes.push({ kind: 'create', document }); return tx; },
        async commit(options) {
          client.commits.push(options);
          mutations.push(changes);
          for (const change of changes) {
            if (change.kind === 'createOnly') {
              if (documents.has(change.document._id)) throw new Error('document already exists');
              documents.set(change.document._id, { ...change.document, _rev: `rev-${mutations.length}` });
            } else if (change.kind === 'replace') {
              documents.set(change.document._id, { ...change.document, _rev: `rev-${mutations.length}` });
            } else if (change.kind === 'create' && !documents.has(change.document._id)) {
              documents.set(change.document._id, { ...change.document });
            } else if (change.kind === 'patch') {
              const document = documents.get(change.id);
              if (change.patch.ifRevisionID && change.patch.ifRevisionID !== document?._rev)
                throw new Error('revision conflict');
              if (change.patch.insert) {
                document.translations.push(...change.patch.insert.items);
              } else if (change.patch.set) {
                const language = change.patch.set && Object.keys(change.patch.set)[0]?.match(/_key=="([^"]+)"/)?.[1];
                if (language) document.translations.find((item) => item._key === language).value = Object.values(change.patch.set)[0];
              }
            }
          }
          return { results: changes.map((change) => ({ id: change.document?._id ?? change.id, document: documents.get(change.document?._id ?? change.id) })) };
        },
      };
      return tx;
    },
  };
  return client;
}

test('Sanity: чтение сохраняет данные и тело, запись поддерживает ревизию и переводы', async () => {
  const client = fakeClient();
  const store = createStore({ client, source: 'sanity' });
  const file = { collection: 'builds', id: 'albedo', path: 'src/content/builds/albedo.md' };
  const parsed = matter(build, { engines: { yaml: (text) => YAML.parse(text) } });
  const original = toDocument(file, parsed.data, parsed.content);
  client.documents.set(original._id, { ...original, _rev: 'before' });
  const read = await store.readEntry('builds', 'albedo');
  assert.equal(read.rev, 'before');
  // Документ без syncHash (например, импортированный до отметок) считается правленым в Studio
  assert.equal(read.studioEdited, true);
  const roundtrip = matter(read.text, { engines: { yaml: (text) => YAML.parse(text) } });
  assert.deepEqual(toDocument(file, roundtrip.data, roundtrip.content), original);

  const rev = await store.writeEntry('builds', 'albedo', read.text, { ifRevision: read.rev });
  assert.equal(rev, 'rev-1');
  assert.deepEqual(client.commits[0], { returnDocuments: true });
  const written = client.documents.get(original._id);
  assert.equal(written.syncHash, contentHash(written));
  assert.equal((await store.readEntry('builds', 'albedo')).studioEdited, false);
  assert.equal(client.mutations[0][0].patch.ifRevisionID, 'before');
  assert.equal(client.mutations[0][1].kind, 'replace');
  const group = client.documents.get('translation.metadata.build.albedo');
  assert.deepEqual(group.translations.map((item) => item._key), ['ru']);
  await store.writeEntry('builds', 'albedo', read.text);
  assert.deepEqual(group.translations.map((item) => item._key), ['ru']);
});

test('Sanity: отметка различает правки Studio и перестановку _key', async () => {
  const client = fakeClient();
  const store = createStore({ client, source: 'sanity' });
  await store.writeEntry('builds', 'albedo', build);
  const document = [...client.documents.values()].find((item) => item._type === 'build');
  assert.ok(document);
  document.body[0]._key = 'studio-key';
  document.body[0].children[0]._key = 'nested-studio-key';
  assert.equal((await store.readEntry('builds', 'albedo')).studioEdited, false);
  document.role = 'Изменено в Studio';
  assert.equal((await store.readEntry('builds', 'albedo')).studioEdited, true);
  delete document.syncHash;
  assert.equal((await store.readEntry('builds', 'albedo')).studioEdited, true);
});

test('Sanity: изменённый body читается вместо устаревшего bodyMarkdown', async () => {
  const client = fakeClient();
  const store = createStore({ client, source: 'sanity' });
  await store.writeEntry('builds', 'albedo', build);
  const document = [...client.documents.values()].find((item) => item._type === 'build');
  assert.ok(document);
  document.body[0].children[0].text = 'Текст из Studio.';
  const read = await store.readEntry('builds', 'albedo');
  assert.equal(read.studioEdited, true);
  assert.match(read.text, /Текст из Studio\./);
  assert.doesNotMatch(read.text, /Текст билда\./);
});

test('Sanity: новый документ создаётся без перезаписи существующего', async () => {
  const client = fakeClient();
  const store = createStore({ client, source: 'sanity' });
  const rev = await store.writeEntry('builds', 'albedo', build, { mustNotExist: true });
  assert.equal(rev, 'rev-1');
  assert.equal(client.mutations[0][0].kind, 'createOnly');
  await assert.rejects(
    store.writeEntry('builds', 'albedo', build, { mustNotExist: true }),
    /документ появился в Studio, перезапустите/,
  );
});

test('Файлы: запись и чтение сохраняют текст побайтно', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cms-store-'));
  try {
    const store = createStore({ root, source: 'files' });
    await store.writeEntry('buildsI18n', 'en/albedo', build);
    assert.deepEqual(await store.readEntry('buildsI18n', 'en/albedo'), { text: build, rev: null, studioEdited: false });
    assert.deepEqual(await store.listEntries('buildsI18n'), ['en/albedo']);
    assert.equal(await readFile(join(root, 'src/content/builds-i18n/en/albedo.md'), 'utf8'), build);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

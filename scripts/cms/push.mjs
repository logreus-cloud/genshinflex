import { isDeepStrictEqual } from 'node:util';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, sep, extname, join } from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import { toDocument } from './mapping.mjs';
import { createStore } from './store.mjs';

const folders = {
  builds: 'builds',
  'builds-i18n': 'buildsI18n',
  rotations: 'rotations',
  banners: 'banners',
  news: 'news',
  'weapon-guides': 'weaponGuides',
  'endgame-guides': 'endgameGuides',
};
const base = resolve('src/content');
const stateFile = '.cache/cms-push.json';
const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry');
const inputs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!inputs.length) throw new Error('Укажите файлы или папки внутри src/content');

const store = createStore({ source: 'sanity' });
let saved;
try { saved = JSON.parse(await readFile(stateFile, 'utf8')); }
catch (error) { if (error.code === 'ENOENT') saved = {}; else throw error; }

async function walk(path) {
  const info = await stat(path);
  if (info.isFile()) return ['.md', '.json'].includes(extname(path)) ? [path] : [];
  const items = await readdir(path, { withFileTypes: true });
  const paths = await Promise.all(items.map((item) => walk(join(path, item.name))));
  return paths.flat().sort();
}

function identify(path) {
  const name = relative(base, path).split(sep).join('/');
  if (name === '..' || name.startsWith('../') || name.startsWith('/'))
    throw new Error(`Путь должен быть внутри src/content: ${path}`);
  const [folder, ...parts] = name.split('/');
  const collection = folders[folder];
  const extension = extname(name);
  if (!collection || !parts.length || extension !== (['rotations', 'banners'].includes(collection) ? '.json' : '.md'))
    throw new Error(`Неизвестный файл контента: ${name}`);
  return { collection, id: parts.join('/').slice(0, -extension.length), path };
}

function content(file, text) {
  if (file.path.endsWith('.json')) return toDocument(file, JSON.parse(text));
  const parsed = matter(text, { engines: { yaml: (source) => YAML.parse(source) } });
  const data = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [
    key, value instanceof Date ? value.toISOString().slice(0, 10) : value,
  ]));
  return toDocument(file, data, parsed.content);
}

const paths = (await Promise.all(inputs.map(async (input) => {
  const path = resolve(input);
  const name = relative(base, path);
  if (name === '..' || name.startsWith(`..${sep}`) || resolve(path) === base)
    throw new Error(`Путь должен быть внутри src/content: ${input}`);
  return walk(path);
}))).flat();

// Итог в конце: без него «ничего не выгружено» выглядело бы как молчаливый сбой
const totals = { same: 0, studio: 0, pushed: 0 };
for (const path of [...new Set(paths)].sort()) {
  const file = identify(path);
  const text = await readFile(path, 'utf8');
  const current = await store.readEntry(file.collection, file.id);
  const document = content(file, text);
  const key = document._id;
  if (current && isDeepStrictEqual(content(file, current.text), document)) { totals.same++; continue; }
  if (current && saved[key] !== current.rev && !force) {
    console.log(`изменён в Studio: ${file.id}`);
    totals.studio++;
    continue;
  }
  if (dry) {
    console.log(`выгрузил бы в Sanity: ${file.id}`);
    totals.pushed++;
    continue;
  }
  const rev = await store.writeEntry(file.collection, file.id, text, { ifRevision: current?.rev, mustNotExist: !current });
  saved[key] = rev;
  await mkdir('.cache', { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(saved, null, 2)}\n`);
  console.log(`выгружено в Sanity: ${file.id}`);
  totals.pushed++;
}
console.log(`Файлов: ${totals.same + totals.studio + totals.pushed}; без изменений: ${totals.same}; ${dry ? 'выгрузилось бы' : 'выгружено'}: ${totals.pushed}; пропущено (правки в Studio, нужен --force): ${totals.studio}`);

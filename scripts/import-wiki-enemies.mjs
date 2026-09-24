// Дополняет src/data/generated/enemies.json врагами с официальной вики HoYoLAB, которых ещё нет в genshin-db
// (новые боссы появляются там раньше). Ключ — английское название, как в данных Бездны.
// Запуск: node scripts/import-wiki-enemies.mjs (входит в npm run import, после import-data)
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/get_entry_page_list';
const LANGS = { en: 'en-us', ru: 'ru-ru', es: 'es-es' };
const ENEMIES_MENU = '7';

async function all(lang) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rpc-language': lang, Referer: 'https://wiki.hoyolab.com/' },
      body: JSON.stringify({ filters: [], menu_id: ENEMIES_MENU, page_num: page, page_size: 50, use_es: true }),
      signal: AbortSignal.timeout(30_000),
    }).then((x) => x.json());
    out.push(...r.data.list);
    if (out.length >= r.data.total || !r.data.list.length) return out;
  }
}

const file = 'src/data/generated/enemies.json';
const enemies = JSON.parse(readFileSync(file, 'utf8'));
const lists = Object.fromEntries(await Promise.all(Object.entries(LANGS).map(async ([code, lang]) => [code, await all(lang)])));
const byId = (code, id) => lists[code].find((x) => x.entry_page_id === id)?.name;
let added = 0;
for (const e of lists.en) {
  if (enemies[e.name]) continue;
  enemies[e.name] = { ru: byId('ru', e.entry_page_id) ?? e.name, en: e.name, es: byId('es', e.entry_page_id) ?? e.name, icon: e.icon_url || null };
  added++;
}
writeFileSync(file, JSON.stringify(enemies));
console.log(`враги с вики: +${added}, всего ${Object.keys(enemies).length}`);

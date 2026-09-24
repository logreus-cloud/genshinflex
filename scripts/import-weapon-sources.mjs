// Где взять оружие: поле «Источник» с официальной вики HoYoLAB (wiki.hoyolab.com) на трёх языках.
// Пишет src/data/generated/weapon-sources.json: { слаг: { ru, en, es } }. Запуск: npm run import:sources
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi';
const STATIC = 'https://sg-wiki-api-static.hoyolab.com/hoyowiki/genshin/wapi';
const LANGS = { ru: 'ru-ru', en: 'en-us', es: 'es-es' };
const headers = (lang) => ({ 'Content-Type': 'application/json', 'x-rpc-language': lang, Referer: 'https://wiki.hoyolab.com/' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// Абзацы и пункты списка — через «; », ссылки вики вида $[{"name":"…"}]$ — просто названием
const clean = (html) => html
  .replace(/\$\[(.*?)\]\$/g, (_m, json) => { try { return JSON.parse(`[${json}]`).map((x) => x.name).join(', '); } catch { return ''; } })
  .replace(/<br\s*\/?>|<\/p>\s*<p[^>]*>|<\/li>\s*<li[^>]*>/g, '; ')
  .replace(/<[^>]+>/g, '')
  .replace(/•/g, '; ')
  .replace(/\s*;\s*(;\s*)*/g, '; ')
  .replace(/^[;\s]+|[;\s]+$/g, '')
  .replace(/\s+/g, ' ');

async function list() {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await fetch(`${API}/get_entry_page_list`, {
      method: 'POST', headers: headers(LANGS.en),
      body: JSON.stringify({ filters: [], menu_id: '4', page_num: page, page_size: 50, use_es: true }),
    }).then((x) => x.json());
    out.push(...r.data.list);
    if (out.length >= r.data.total || !r.data.list.length) return out;
  }
}

async function source(id, lang) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${STATIC}/entry_page?entry_page_id=${id}`, { headers: headers(lang), signal: AbortSignal.timeout(20_000) }).then((x) => x.json());
      const attrs = r.data.page.modules.find((m) => m.components?.some((c) => c.component_id === 'baseInfo'))
        ?.components.find((c) => c.component_id === 'baseInfo');
      const rows = JSON.parse(attrs?.data ?? '{"list":[]}').list;
      // Поле называется по-разному: Source / Где найти / Cómo se consigue; у новинок перевод иногда пустой
      const row = rows.find((x) => /^(Source|Где найти|Источник|Cómo se consigue|Fuente)/i.test(x.key));
      const text = row ? clean(row.value.filter(Boolean).join('; ')) : '';
      return text || null;
    } catch { await sleep(1000); }
  }
  return null;
}

const weapons = JSON.parse(readFileSync('src/data/generated/weapons.en.json', 'utf8'));
const bySim = new Map(weapons.map((w) => [key(w.nameEn), w.slug]));
const entries = await list();
const result = {};
let missing = 0;
for (const e of entries) {
  const slug = bySim.get(key(e.name));
  if (!slug) continue;
  const row = {};
  for (const [code, lang] of Object.entries(LANGS)) { row[code] = await source(e.entry_page_id, lang); await sleep(120); }
  // Нет перевода — показываем английский текст
  if (row.en) result[slug] = { ru: row.ru ?? row.en, en: row.en, es: row.es ?? row.en }; else missing++;
}
writeFileSync('src/data/generated/weapon-sources.json', JSON.stringify(result, null, 1));
console.log(`источники: ${Object.keys(result).length} из ${weapons.length} оружий, без поля «Источник»: ${missing}`);

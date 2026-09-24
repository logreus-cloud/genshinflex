// История баннеров из открытых данных paimon.moe (MIT): github.com/MadeBaruna/paimon-moe
// Запуск: npm run import (вызывается вместе с import-data)
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/banners.js';
const OUT = new URL('../src/data/generated/banner-history.json', import.meta.url);
const gen = (f) => JSON.parse(readFileSync(new URL(`../src/data/generated/${f}.json`, import.meta.url), 'utf8'));

const code = await fetch(SRC).then((r) => { if (!r.ok) throw new Error(`paimon.moe: ${r.status}`); return r.text(); });
const { banners } = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`);

// В paimon.moe id через «_» и без апострофов — сравниваем по буквам и цифрам
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const chars = new Map(gen('characters').map((c) => [norm(c.slug), c.slug]));
const weapons = new Map(gen('weapons').map((w) => [norm(w.slug), w.slug]));
const map = (ids = [], ...pools) => ids.map((id) => pools.map((p) => p.get(norm(id))).find(Boolean)).filter(Boolean);

const day = (s) => s.slice(0, 10);
const phases = new Map();
const phaseOf = (b) => {
  const key = `${b.version}|${day(b.start)}`;
  if (!phases.has(key)) phases.set(key, { version: b.version, start: b.start.slice(0, 16), end: b.end.slice(0, 16), characters: [], weapons: null, chronicled: null });
  return phases.get(key);
};

for (const b of banners.characters) {
  phaseOf(b).characters.push({ name: b.name, five: map(b.featured, chars), four: map(b.featuredRare, chars) });
}
for (const b of banners.weapons) {
  phaseOf(b).weapons = { name: b.name, five: map(b.featured, weapons), four: map(b.featuredRare, weapons) };
}
for (const b of banners.chronicled ?? []) {
  phaseOf(b).chronicled = { name: b.name, five: map(b.featured, chars, weapons), four: map(b.featuredRare, chars, weapons) };
}

// Нумерация фаз внутри версии и отметка «впервые / повтор» для 5★ персонажей
const list = [...phases.values()].sort((a, b) => a.start.localeCompare(b.start));
const seen = new Map();
const byVersion = new Map();
for (const p of list) {
  p.phase = (byVersion.get(p.version) ?? 0) + 1;
  byVersion.set(p.version, p.phase);
  for (const banner of p.characters) {
    banner.reruns = banner.five.map((s) => { const n = seen.get(s) ?? 0; seen.set(s, n + 1); return n; });
  }
}

writeFileSync(OUT, JSON.stringify(list));
console.log(`banner-history: ${list.length} фаз, версии ${list[0].version}–${list.at(-1).version}`);

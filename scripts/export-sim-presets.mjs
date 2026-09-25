import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const investments = JSON.parse(readFileSync('src/data/investments.json', 'utf8'));
const characters = JSON.parse(readFileSync('src/data/generated/characters.en.json', 'utf8'));
const weapons = JSON.parse(readFileSync('src/data/generated/weapons.en.json', 'utf8'));
const artifacts = JSON.parse(readFileSync('src/data/generated/artifacts.en.json', 'utf8'));
const key = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const byKey = new Map(characters.flatMap((c) => c.slug.startsWith('traveler-')
  ? ['aether', 'lumine'].map((name) => [name + c.slug.slice(9), c.slug])
  : [[key(c.nameEn), c.slug]]));
// Оружие и сеты, которые знает наша сборка gcsim: новое оружие появляется в игре раньше, чем в gcsim,
// и одно неизвестное имя роняет весь конфиг. Неизвестных не кладём в таблицу — симулятор оставит эталонное.
// Список берём из исходников (.cache/gcsim-src), а снимок храним в репозитории для сборки без исходников.
const KNOWN = 'scripts/gcsim-known.json';
const SRC = '.cache/gcsim-src/pkg/shortcut';
if (existsSync(SRC)) {
  const names = (file) => [...readFileSync(`${SRC}/${file}`, 'utf8').matchAll(/^\s*"(\w+)":\s+keys\./gm)].map((m) => m[1]).sort();
  writeFileSync(KNOWN, `${JSON.stringify({ weapons: names('weapon.dm.go'), sets: names('artifact.dm.go') })}\n`);
}
const known = JSON.parse(readFileSync(KNOWN, 'utf8'));
const knownWeapons = new Set(known.weapons), knownSets = new Set(known.sets);
const ids = {
  chars: Object.fromEntries(characters.filter((c) => !c.slug.startsWith('traveler-')).map((c) => [c.id, c.slug])),
  weapons: Object.fromEntries(weapons.map((w) => [w.id, key(w.nameEn)]).filter(([, k]) => knownWeapons.has(k))),
  sets: Object.fromEntries(artifacts.map((a) => [a.id, key(a.nameEn)]).filter(([, k]) => knownSets.has(k))),
};
console.log(`Оружия в таблице: ${Object.keys(ids.weapons).length} из ${weapons.length}, сетов: ${Object.keys(ids.sets).length} из ${artifacts.length}`);

function withoutIterations(config) {
  return config.split('\n').map((line) => {
    if (!/^\s*options\b/.test(line)) return line;
    const clean = line.replace(/\s+\b(?:iteration|workers)=\d+(?=\s|;|$)/g, '');
    return /^\s*options\s*;\s*(?:#.*)?$/.test(clean) ? '' : clean;
  }).filter((line) => line !== '').join('\n');
}

const presets = {};
for (const [slug, entry] of Object.entries(investments)) {
  if (slug === '_meta') continue;
  const file = `.cache/sims/${slug}/c0.txt`;
  if (!existsSync(file)) {
    console.log(`— ${slug}: нет ${file}`);
    continue;
  }
  const config = readFileSync(file, 'utf8');
  const aliases = [...config.matchAll(/^\s*([a-zA-Z0-9_]+)\s+char\b/gm)].map((m) => m[1]);
  if (!Array.isArray(entry.team) || aliases.length !== entry.team.length) {
    console.log(`— ${slug}: порядок команды не совпадает с конфигом`);
    continue;
  }
  const members = entry.team.map((name, i) => ({ slug: byKey.get(name), alias: aliases[i] }));
  if (members.some((member) => !member.slug)) {
    console.log(`— ${slug}: неизвестный персонаж в команде`);
    continue;
  }
  presets[slug] = {
    config: withoutIterations(config), members, dps: entry.dps, source: entry.source,
    ...(entry.own ? { own: true } : {}),
  };
}

mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/sim-presets.json', JSON.stringify({ gcsim: investments._meta.gcsim, presets, ids }));
console.log(`Записано пресетов: ${Object.keys(presets).length}`);

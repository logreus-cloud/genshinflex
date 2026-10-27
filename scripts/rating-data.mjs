import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { aggregate, classifyTeam, supportStrength, swapPairs } from '../src/lib/rating/core.ts';

const DB = 'https://db.kqm.gg/api/db';
const CACHE = '.cache/rating/db.json';
const SHARES = '.cache/rating/shares';
const SIM = '.cache/rating/sim';
const SIM_BIN = '.cache/gcsim.exe';
const OUT = 'src/data/rating.json';
const AGENT = 'GenshinFlex-rating (+https://github.com/logreus-cloud/genshinflex)';
const cached = process.argv.includes('--cached');
const resim = process.argv.includes('--resim');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Не строка (битая запись базы) — пустой ключ: такая запись не найдётся и будет пропущена
const key = (name) => (typeof name === 'string' ? name.toLowerCase().replace(/[^a-z0-9]/g, '') : '');
const keysOf = (character) => character.slug.startsWith('traveler-')
  ? ['aether', 'lumine'].map((prefix) => prefix + character.slug.slice(9)) : [key(character.nameEn)];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const json = await response.json();
  if (json.error) throw new Error(`База gcsim: ${json.error}`);
  return json;
}

async function loadDb() {
  if (cached) return JSON.parse(readFileSync(CACHE, 'utf8')).map(({ config, ...entry }) => entry);
  const entries = [];
  for (let skip = 0; ; skip += 100) {
    const q = { project: { config: 0 }, limit: 100, skip };
    const response = await fetchJson(`${DB}?q=${encodeURIComponent(JSON.stringify(q))}`);
    if (!Array.isArray(response.data)) throw new Error('База gcsim: нет массива data');
    entries.push(...response.data.map(({ config, ...entry }) => entry));
    if (response.data.length < 100) break;
    await sleep(200);
  }
  mkdirSync('.cache/rating', { recursive: true });
  writeFileSync(CACHE, `${JSON.stringify(entries)}\n`);
  return entries;
}

const characters = JSON.parse(readFileSync('src/data/generated/characters.en.json', 'utf8'));
const weapons = JSON.parse(readFileSync('src/data/generated/weapons.en.json', 'utf8'));
const characterBy = new Map(characters.flatMap((character) => keysOf(character).map((name) => [name, character])));
const weaponBy = new Map(weapons.map((weapon) => [key(weapon.nameEn), weapon]));

function baseline(entry) {
  const summary = entry.summary;
  if (entry.is_db_valid !== true || !Array.isArray(summary?.char_names) || summary.char_names.length !== 4
    || !Array.isArray(summary.team) || summary.team.length !== 4) return null;
  const members = summary.char_names.map((name) => characterBy.get(key(name)));
  if (members.some((member) => !member)) return null;
  for (let i = 0; i < 4; i++) {
    const member = summary.team.find((item) => key(item.name) === key(summary.char_names[i]));
    const character = members[i];
    const weapon = member?.weapon && weaponBy.get(key(member.weapon.name));
    if (!member || !weapon) return null;
    // База не пишет поля со значением по умолчанию: нет cons — это C0, нет refine — R1
    // Созвездия путешественника открываются бесплатно — для него, как для 4★, любые
    if (character.rarity === 5 && !character.slug.startsWith('traveler-') && (member.cons ?? 0) !== 0) return null;
    if (weapon.rarity === 5 && (member.weapon.refine ?? 1) !== 1) return null;
  }
  const dps = summary.mean_dps_per_target;
  const targets = summary.target_count;
  if (!Number.isFinite(dps) || dps <= 0 || !Number.isFinite(targets) || targets <= 0) return null;
  return { entry, row: { id: entry._id, m: members.map((member) => member.slug), dps: Math.round(dps), targets }, rawDps: dps };
}

function resultMembers(result) {
  const statistics = result?.statistics;
  const details = result?.character_details;
  const dps = statistics?.dps?.mean;
  if (!Number.isFinite(dps) || dps <= 0 || !Array.isArray(details) || details.length !== 4) return null;
  const members = details.map((detail, i) => ({
    slug: characterBy.get(key(detail?.name))?.slug,
    dps: statistics.character_dps?.[i]?.mean,
    fieldTime: statistics.field_time?.[i]?.mean,
  }));
  if (members.some((member) => !member.slug || !Number.isFinite(member.dps)
    || !Number.isFinite(member.fieldTime))) return null;
  return { statistics, details, dps, members };
}

const entries = await loadDb();
const base = entries.map(baseline).filter(Boolean);
const unique = new Map();
for (const item of base) {
  const teamKey = JSON.stringify([[...item.row.m].sort(), item.row.targets]);
  const previous = unique.get(teamKey);
  if (!previous || item.rawDps > previous.rawDps) unique.set(teamKey, item);
}
if (!existsSync(SIM_BIN)) console.log(`Нет ${SIM_BIN}, свои прогоны пропущены`);
else {
  mkdirSync(SIM, { recursive: true });
  const files = existsSync('scripts/sim-teams') ? readdirSync('scripts/sim-teams').filter((name) => name.endsWith('.txt')).sort() : [];
  for (const file of files) {
    const slug = file.slice(0, -4);
    const source = `scripts/sim-teams/${file}`;
    let hash;
    try { hash = createHash('sha1').update(readFileSync(source)).digest('hex'); }
    catch (error) { console.log(`Не читается ${source}: ${error.message}`); continue; }
    const hashFile = `${SIM}/${slug}.hash`;
    const outFile = `${SIM}/${slug}.json`;
    let payload;
    if (!resim && existsSync(outFile) && existsSync(hashFile) && readFileSync(hashFile, 'utf8').trim() === hash) {
      try { payload = JSON.parse(readFileSync(outFile, 'utf8')); }
      catch { console.log(`Повреждён кэш ${slug}, пересчитываем`); }
    }
    try {
      if (!payload) {
        const inFile = `${SIM}/${slug}.txt`;
        copyFileSync(source, inFile);
        execFileSync(SIM_BIN, ['-c', inFile, '-out', outFile, '-nb', '-substatOptimFull'],
          { stdio: 'pipe', timeout: 300_000, killSignal: 'SIGKILL' });
        payload = JSON.parse(readFileSync(outFile, 'utf8'));
        writeFileSync(hashFile, `${hash}\n`);
      }
      const result = payload.data ?? payload;
      const parsed = resultMembers(result);
      const targets = result?.target_details?.length;
      if (!parsed || !Number.isFinite(targets) || targets <= 0
        || new Set(parsed.members.map((member) => member.slug)).size !== 4) {
        console.log(`Свой прогон ${slug}: неполный результат, пропущен`);
        continue;
      }
      let valid = true;
      for (const detail of parsed.details) {
        const character = characterBy.get(key(detail?.name));
        const weapon = weaponBy.get(key(detail?.weapon?.name));
        if (!character || !weapon
          || (character.rarity === 5 && !character.slug.startsWith('traveler-') && (detail.cons ?? 0) !== 0)
          || (weapon.rarity === 5 && (detail.weapon.refine ?? 1) !== 1)) valid = false;
      }
      if (!valid) {
        console.log(`Свой прогон ${slug}: не соответствует базе C0/R1, пропущен`);
        continue;
      }
      const rawDps = parsed.dps / targets;
      const row = { id: `own:${slug}`, m: parsed.members.map((member) => member.slug),
        dps: Math.round(rawDps), targets };
      const teamKey = JSON.stringify([[...row.m].sort(), row.targets]);
      const previous = unique.get(teamKey);
      if (!previous || rawDps > previous.rawDps) unique.set(teamKey, { row, rawDps, parsed });
    } catch (error) {
      console.log(`Свой прогон ${slug}: ${error.message}`);
    }
  }
}
const teams = [...unique.values()].sort((a, b) => b.rawDps - a.rawDps);
const selected = new Map(teams.slice(0, 200).map((item) => [item.row.id, item]));
for (const character of characters) {
  let count = 0;
  for (const item of teams) {
    if (!item.row.m.includes(character.slug)) continue;
    selected.set(item.row.id, item);
    if (++count === 3) break;
  }
}
for (const item of teams) if (item.parsed) selected.set(item.row.id, item);

let lastRequest = 0;
const shareStats = { loaded: 0, cached: 0, failed: 0, invalid: 0, processed: 0 };
async function loadShare(shareKey) {
  if (!shareKey) { shareStats.failed++; return null; }
  const file = `${SHARES}/${encodeURIComponent(shareKey).replaceAll('.', '%2E')}.json`;
  if (existsSync(file)) {
    try { shareStats.cached++; return JSON.parse(readFileSync(file, 'utf8')); }
    catch { shareStats.cached--; console.log(`Повреждён кэш ${shareKey}, загружаем снова`); }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sleep(Math.max(0, 250 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      const data = await fetchJson(`https://gcsim.app/api/share/${encodeURIComponent(shareKey)}`);
      mkdirSync(SHARES, { recursive: true });
      writeFileSync(file, `${JSON.stringify(data)}\n`);
      shareStats.loaded++;
      return data;
    } catch (error) {
      if (attempt === 1) console.log(`Не загрузился результат ${shareKey}: ${error.message}`);
    }
  }
  shareStats.failed++;
  return null;
}

function reactionOf(statistics) {
  const counts = new Map();
  for (const group of statistics.source_reactions ?? []) {
    const sources = group?.sources ?? {};
    for (const [name, source] of Object.entries(sources)) {
      const code = Array.isArray(sources) ? (source?.name ?? source?.reaction) : name;
      if (typeof code !== 'string' || !Number.isFinite(source?.mean)) continue;
      const clean = code.replace(/-(pyro|hydro|anemo|electro|dendro|cryo|geo)$/, '');
      counts.set(clean, (counts.get(clean) ?? 0) + source.mean);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const samples = new Map();
function record(slug, role, value, row) {
  const roles = samples.get(slug) ?? new Map();
  const list = roles.get(role) ?? [];
  list.push({ value, id: row.id, team: row.m });
  roles.set(role, list);
  samples.set(slug, roles);
}

let ownCount = 0;
for (const item of selected.values()) {
  let parsed = item.parsed;
  if (!parsed) {
    const payload = await loadShare(item.entry.share_key);
    if (!payload) continue;
    parsed = resultMembers(payload.data ?? payload);
  }
  if (!parsed || parsed.members.some((member) => !item.row.m.includes(member.slug))) {
    shareStats.invalid++;
    continue;
  }
  const roles = classifyTeam(parsed.members, parsed.dps);
  // Свои прогоны (ротации не проверены сообществом) попадают только в списки команд, а не в оценки ролей
  if (!item.parsed) for (const member of parsed.members) record(member.slug, roles[member.slug],
    // Урон на цель, как у команд: иначе прогоны против нескольких врагов завышают личный урон
    (roles[member.slug] === 'support' ? parsed.dps : member.dps) / item.row.targets, item.row);
  const reaction = reactionOf(parsed.statistics);
  if (reaction) item.row.reaction = reaction;
  if (item.parsed) ownCount++;
  else shareStats.processed++;
}

// Роль засчитываем, если персонаж играет её хотя бы в 30% своих симуляций (основная роль остаётся всегда):
// иначе у керри появляется «поддержка 44» из одной случайной команды
const mainRoles = (roles) => {
  const total = [...roles.values()].reduce((sum, rows) => sum + rows.length, 0);
  const top = Math.max(...[...roles.values()].map((rows) => rows.length));
  return [...roles].filter(([, rows]) => rows.length === top || rows.length >= 0.3 * total);
};
const rolesBy = new Map([...samples].map(([slug, roles]) => [slug, mainRoles(roles)]));
const eligible = new Set([...rolesBy].filter(([, roles]) => roles.some(([role]) => role === 'support'))
  .map(([slug]) => slug));
const pairs = swapPairs(teams.map(({ row }) => row).filter((row) => !row.id.startsWith('own:')), eligible);
const strength = supportStrength(pairs);
const sparse = [];
const ratingCharacters = Object.fromEntries([...rolesBy].map(([slug, roles]) => [slug, Object.fromEntries(roles.flatMap(([role, rows]) => {
  const best = rows.reduce((a, b) => b.value > a.value ? b : a);
  const n = role === 'support' ? strength[slug]?.n ?? 0 : rows.length;
  // Меньше 10 замен — сила поддержки ещё случайна; за неё отвечает экспертная оценка
  if (role === 'support' && n < 10) {
    sparse.push(`${slug} (${n})`);
    return [];
  }
  const value = role === 'support' ? Math.exp(strength[slug].s) : aggregate(rows.map((row) => row.value));
  return [[role, { value, n, best: { id: best.id, team: best.team } }]];
}))]));
const data = {
  _meta: { date: new Date().toISOString().slice(0, 10), source: 'https://db.kqm.gg',
    entries: entries.length, baseline: base.length, teams: teams.length, shares: shareStats.processed,
    pairs: pairs.length, own: ownCount },
  characters: ratingCharacters, teams: teams.map(({ row }) => row),
};
writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`);
const roleCounts = ['carry', 'subdps', 'support']
  .map((role) => `${role}: ${Object.values(ratingCharacters).filter((roles) => roles[role]).length}`).join(', ');
console.log(`Записей ${entries.length}, база ${base.length}, команд ${teams.length}, свои ${ownCount}, пары ${pairs.length}; результаты: сеть ${shareStats.loaded}, кэш ${shareStats.cached}, ошибки ${shareStats.failed}, неполные ${shareStats.invalid}; персонажи ${roleCounts}`);
console.log(`Поддержки с менее чем 10 заменами: ${sparse.length ? sparse.join(', ') : 'нет'}`);

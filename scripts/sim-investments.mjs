// Сколько урона команде дают созвездия и лучшее 5★ оружие: считаем симуляциями gcsim (https://gcsim.app).
// gcsim — открытый симулятор боя сообщества (AGPL); мы используем только результаты его прогонов.
//
// Для каждого персонажа с гайдом:
//   1. Берём команду из открытой базы gcsim: сначала ближайшую к командам из нашего гайда,
//      затем с минимальным созвездием персонажа, затем с самым высоким DPS.
//   2. Прогоняем её 8 раз, меняя только этого персонажа:
//      C0…C6 с лучшим 4★ оружием из нашего гайда (R5) и C0 с лучшим 5★ оружием из гайда (R1).
//   3. Пишем прирост урона всей команды в процентах относительно C0 + 4★ в src/data/investments.json.
//
// Запуск: npm run sim -- [слаги…] [--dry] [--force]
//   --dry — только скачать команды и сохранить конфиги в .cache/sims/, ничего не симулируя.
// Нужен .cache/gcsim.exe — скачайте gcsim_windows_amd64.exe из github.com/genshinsim/gcsim/releases и переименуйте.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';

const GCSIM = '.cache/gcsim.exe';
const OUT = 'src/data/investments.json';
const ITERATIONS = 500;
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.filter((a) => !a.startsWith('--'));
if (!dry && !existsSync(GCSIM)) { console.error(`Нет ${GCSIM}. Скачайте gcsim_windows_amd64.exe: https://github.com/genshinsim/gcsim/releases`); process.exit(1); }

const chars = JSON.parse(readFileSync('src/data/generated/characters.en.json', 'utf8'));
const weapons = JSON.parse(readFileSync('src/data/generated/weapons.en.json', 'utf8'));
const weaponBy = new Map(weapons.map((w) => [w.slug, w]));
// Ключи gcsim — английское название без пробелов и знаков: «Kaedehara Kazuha» → kaedeharakazuha
const key = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// Оружие из гайда: первое 4★ — «доступная база», первое 5★ — «лучшее 5★»
function guideWeapons(slug) {
  const md = readFileSync(`src/content/builds/${slug}.md`, 'utf8');
  const list = [...md.matchAll(/^\s+- slug: ([a-z0-9-]+)/gm)].map((m) => weaponBy.get(m[1])).filter(Boolean);
  return { four: list.find((w) => w.rarity === 4), five: list.find((w) => w.rarity === 5) };
}

// Команды из гайда — в ключах gcsim
function guideTeams(slug) {
  const md = readFileSync(`src/content/builds/${slug}.md`, 'utf8');
  return [...md.matchAll(/members: \[([^\]]+)\]/g)].map((m) => m[1].split(',').map((x) => chars.find((c) => c.slug === x.trim())).filter(Boolean).map((c) => key(c.nameEn)));
}

async function pickTeam(ck, teams) {
  const q = { query: { 'summary.char_names': ck, is_db_valid: true }, limit: 100, skip: 0 };
  const res = await fetch(`https://simpact.app/api/db?q=${encodeURIComponent(JSON.stringify(q))}`, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json()).catch(() => ({}));
  const list = (res.data ?? []).filter((e) => e.summary?.target_count === 1);
  const cons = (e) => e.summary.team.find((m) => m.name === ck)?.cons ?? 0;
  const overlap = (e) => Math.max(0, ...teams.map((t) => t.filter((k) => e.summary.char_names.includes(k)).length));
  const burst = (e) => (usesBurst(e.config, ck) ? 1 : 0);
  // Сначала — ротации, где персонаж использует взрыв стихии: иначе созвездия на взрыв ничего не покажут
  list.sort((a, b) => burst(b) - burst(a) || overlap(b) - overlap(a) || cons(a) - cons(b) || b.summary.mean_dps_per_target - a.summary.mean_dps_per_target);
  return list[0];
}

// Использует ли персонаж взрыв стихии в ротации. В строках ротации имя часто сокращено (mav вместо mavuika),
// поэтому персонажем считаем любое слово от трёх букв, с которого начинается его ключ или имя из строки «char»
function usesBurst(config, ck) {
  const names = [ck, ...[...config.matchAll(/^\s*(\w+)\s+char\b/gm)].map((m) => m[1]).filter((a) => ck.includes(a) || a.includes(ck))];
  const isHim = (w) => w.length >= 3 && names.some((n) => n.startsWith(w));
  // Команды ротации делим по «;» и скобкам: в строке их может быть несколько, а одна команда — растянута на несколько строк
  const rotation = config.split('\n').filter((l) => !/\b(char|add)\b/.test(l)).join('\n');
  return rotation.split(/[;{}]/).some((st) => {
    const m = st.trim().match(/^(\w+)\s+([\s\S]*)$/);
    if (m && isHim(m[1]) && /\bburst\b/.test(m[2])) return true;
    return [...st.matchAll(/\.(\w+)\.burst\b/g)].some((x) => isHim(x[1]));
  });
}

// Меняем в конфиге только нашего персонажа: созвездие, оружие и число прогонов
function variant(config, ck, cons, weapon, refine) {
  return config
    .replace(new RegExp(`^(${ck}\\s+char\\b[^;]*?\\bcons=)\\d+`, 'm'), `$1${cons}`)
    .replace(new RegExp(`^(${ck}\\s+add\\s+weapon=)"[^"]+"(\\s+refine=)\\d+`, 'm'), `$1"${weapon}"$2${refine}`)
    .replace(/\biteration=\d+/, `iteration=${ITERATIONS}`)
    // Не больше 8 потоков — иначе gcsim съедает память всего компьютера
    .replace(/\bworkers=\d+/, (m) => `workers=${Math.min(8, Number(m.slice(8)))}`)
    .replace(/\bdebug=true\b/, 'debug=false');
}

// optimize — подобрать доп. статы всей команды по стандарту KQM (gcsim перезаписывает конфиг подобранными статами).
// Без этого смена оружия нечестна: статы автора симуляции подогнаны под его оружие, особенно восстановление энергии.
function simulate(file, optimize = false) {
  const out = file.replace(/\.txt$/, '.json');
  // Оптимизатор изредка зацикливается — ограничиваем время, зависший прогон считается неудачным
  execFileSync(GCSIM, ['-c', file, '-out', out, '-nb', ...(optimize ? ['-substatOptimFull'] : [])], { stdio: 'pipe', timeout: (optimize ? 300 : 120) * 1000, killSignal: 'SIGKILL' });
  const r = JSON.parse(readFileSync(out, 'utf8'));
  const dps = r.statistics?.dps?.mean ?? r.statistics?.DPS?.mean;
  if (!dps) throw new Error(`в результате ${out} нет statistics.dps.mean`);
  return dps;
}

// Результаты, которые симуляция не может показать честно, заменяем на «нет данных»:
// 5★ заметно хуже 4★ — ротация из базы построена под энергию 4★ оружия и ломается без неё;
// урон падает после созвездия — ротация несовместима с ним. Порог 3% — выше шума симуляции.
function sanitize(all) {
  for (const r of Object.values(all)) {
    if (!r?.cons) continue;
    if (r.weapon !== null && r.weapon < -3) { r.weapon = null; r.five = null; }
    let prev = 0;
    r.cons = r.cons.map((v) => { if (v === null || v < prev - 3) return null; prev = v; return v; });
  }
  return all;
}

const result = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const slugs = only.length ? only : readdirSync('src/content/builds').map((f) => f.replace(/\.md$/, ''));
for (const slug of slugs) {
  const c = chars.find((x) => x.slug === slug);
  // Уже посчитанных пропускаем, чтобы прерванный прогон продолжался с места остановки (--force — пересчитать)
  if (!c || (result[slug] && !only.length && !args.includes('--force'))) continue;
  const ck = key(c.nameEn);
  const { four, five } = guideWeapons(slug);
  const entry = await pickTeam(ck, guideTeams(slug));
  if (!entry) { console.log(`— ${slug}: нет команды в базе gcsim`); continue; }
  // В конфиге персонаж может быть записан сокращённо (raiden, yae, ayaka) — берём имя из строк «<имя> char»
  const aliases = [...entry.config.matchAll(/^\s*(\w+)\s+char\b/gm)].map((m) => m[1]);
  const alias = aliases.find((a) => a === ck) ?? aliases.find((a) => ck.includes(a) || a.includes(ck))
    ?? aliases[entry.summary.team.findIndex((m) => m.name === ck)] ?? ck;
  // База — лучшее 4★ из гайда (R5); если в гайде только 5★ — оружие из исходной симуляции
  const own = entry.summary.team.find((m) => m.name === ck).weapon;
  const baseWeapon = four ?? weapons.find((w) => key(w.nameEn) === own.name);
  const base = four ? { name: key(four.nameEn), refine: 5 } : own;
  // Сравнение с 5★ — только если оно отличается от базы
  const sig = five && five.slug !== baseWeapon?.slug ? five : null;

  const dir = `.cache/sims/${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/c0.txt`, variant(entry.config, alias, 0, base.name, base.refine));
  if (sig) writeFileSync(`${dir}/sig.txt`, variant(entry.config, alias, 0, key(sig.nameEn), 1));
  if (dry) { console.log(`✓ ${slug}: команда ${entry.summary.char_names.join(', ')} → ${dir}`); continue; }

  try {
    // Статы подбираем под каждое оружие отдельно; созвездия C1–C6 считаем на статах C0,
    // так прогон занимает около минуты на персонажа вместо четырёх
    // Оптимизатор gcsim работает не со всеми конфигами (нужна отдельная строка основных статов).
    // Тогда считаем созвездия на статах автора симуляции, а сравнение оружия пропускаем — без подбора статов оно нечестное.
    let optimized = true;
    const dps = {};
    try { dps.c0 = simulate(`${dir}/c0.txt`, true); } catch {
      optimized = false;
      writeFileSync(`${dir}/c0.txt`, variant(entry.config, alias, 0, base.name, base.refine));
      dps.c0 = simulate(`${dir}/c0.txt`);
    }
    if (sig && optimized) try { dps.sig = simulate(`${dir}/sig.txt`, true); } catch { console.log(`  ${slug}: 5★ оружие не посчиталось`); }
    const tuned = readFileSync(`${dir}/c0.txt`, 'utf8');
    for (const n of [1, 2, 3, 4, 5, 6]) {
      writeFileSync(`${dir}/c${n}.txt`, variant(tuned, alias, n, base.name, base.refine));
      // Ротация исходной симуляции иногда несовместима с созвездием — такой шаг оставляем без данных
      try { dps[`c${n}`] = simulate(`${dir}/c${n}.txt`); } catch { dps[`c${n}`] = null; }
    }
    const pct = (v) => (v == null ? null : Math.round((v / dps.c0 - 1) * 1000) / 10);
    result[slug] = {
      team: entry.summary.char_names,
      source: `https://gcsim.app/db/${entry._id}`,
      four: baseWeapon?.slug ?? null, refine: base.refine, five: dps.sig ? sig.slug : null,
      cons: [1, 2, 3, 4, 5, 6].map((n) => pct(dps[`c${n}`])),
      weapon: pct(dps.sig),
      dps: Math.round(dps.c0),
      optimized,
    };
    console.log(`✓ ${slug}: C1–C6 ${result[slug].cons.map((v) => v ?? '—').join(' / ')} %, 5★ ${result[slug].weapon ?? '—'} %${optimized ? '' : ' (статы автора)'}`);
    writeFileSync(OUT, `${JSON.stringify({ ...sanitize(result), _meta: { gcsim: execFileSync(GCSIM, ['-version']).toString().trim().slice(0, 7), date: new Date().toISOString().slice(0, 10), iterations: ITERATIONS } }, null, 1)}\n`);
  } catch (e) {
    console.log(`✗ ${slug}: ${String(e.message).split('\n')[0]}`);
  }
}

// Вышедшие персонажи, которых ещё нет в genshin-db: берём их из Project Amber (gi.yatta.moe)
// и дописываем в src/data/generated/characters*.json и public/data/levelup.json в том же формате.
// Запуск: npm run import:amber (входит в npm run import, идёт после import-levelup).
// Проверка: node scripts/import-amber.mjs --check — ничего не пишет, строит тем же кодом Весну
// и сравнивает с данными genshin-db.
import { readFileSync, writeFileSync } from 'node:fs';

// Слаг задан явно: у Валерия официальное имя Valeriy, а адреса и гайды живут на valery
const CHARACTERS = [
  { id: 10000136, slug: 'mitya', version: '7.2' },
  { id: 10000137, slug: 'valery', version: '7.2' },
];
const CONTROL = { id: 10000143, slug: 'vesna', version: '7.1' };

const API = 'https://gi.yatta.moe/api/v2';
// enka.network новых картинок пока не отдаёт
const ASSETS = 'https://gi.yatta.moe/assets/UI/';
const HEADERS = { 'User-Agent': 'GenshinFlex-import' };
const LEVELUP = 'public/data/levelup.json';
const MORA = 202;
const DEC = { ru: ',', en: '.', es: ',' };
const FILES = { ru: 'characters.json', en: 'characters.en.json', es: 'characters.es.json' };
const OUT = new URL('../src/data/generated/', import.meta.url);

const ELEMENTS = {
  Fire: 'pyro', Water: 'hydro', Wind: 'anemo', Electric: 'electro',
  Grass: 'dendro', Ice: 'cryo', Rock: 'geo',
};
const WEAPONS = {
  WEAPON_SWORD_ONE_HAND: 'sword', WEAPON_CLAYMORE: 'claymore', WEAPON_POLE: 'polearm',
  WEAPON_BOW: 'bow', WEAPON_CATALYST: 'catalyst',
};
const SUBSTATS = {
  FIGHT_PROP_CRITICAL_HURT: { ru: 'Крит. урон', en: 'CRIT DMG', es: 'Daño CRIT' },
  FIGHT_PROP_CRITICAL: { ru: 'Шанс крит. попадания', en: 'CRIT Rate', es: 'Prob. CRIT' },
  FIGHT_PROP_ATTACK_PERCENT: { ru: 'Сила атаки', en: 'ATK', es: 'ATQ' },
};
const FLAT = new Set(['FIGHT_PROP_ELEMENT_MASTERY', 'FIGHT_PROP_BASE_ATTACK']);
// Базовые значения: у genshin-db они входят в стат возвышения
const SUB_BASE = { FIGHT_PROP_CRITICAL: 0.05, FIGHT_PROP_CRITICAL_HURT: 0.5, FIGHT_PROP_CHARGE_EFFICIENCY: 1 };
const LEVELS = [['1', 0], ['20', 0], ['20+', 1], ['40', 1], ['40+', 2], ['50', 2], ['50+', 3], ['60', 3], ['60+', 4], ['70', 4], ['70+', 5], ['80', 5], ['80+', 6], ['90', 6], ['95', 6], ['100', 6]];
const MONTHS = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};
const birthday = ([month, day], code) => ({
  ru: `${day} ${MONTHS.ru[month - 1]}`,
  en: `${MONTHS.en[month - 1]} ${day}`,
  es: `${day} de ${MONTHS.es[month - 1]}`,
})[code];

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const asset = (file) => `${ASSETS}${file}.png`;

async function json(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()).data;
}

// Ссылки на термины в genshin-db становятся жирным, остальная разметка убирается
const text = (s = '') => s
  .replace(/^#/, '')
  .replace(/\\n/g, '\n')
  .replace(/\{NON_BREAK_SPACE\}/g, ' ')
  // Подпись для клавиатуры: варианты для телефона и приставки не показываем
  .replace(/\{LAYOUT_MOBILE#[^}]*\}|\{LAYOUT_PS#[^}]*\}/g, '')
  .replace(/\{LAYOUT_PC#([^}]*)\}/g, '$1')
  .replace(/<color=[^>]*>|<\/color>/g, '')
  .replace(/\{LINK#[^}]*\}\{\/LINK\}/g, '')
  .replace(/\{LINK#[^}]*\}([^{]*)\{\/LINK\}/g, '**$1**');

// «Урон навыка|{param1:F1P}» → строка значений по уровням таланта, как в import-data.mjs
function formatParam(value, fmt, dec) {
  const pct = fmt.endsWith('P');
  const digits = Number(fmt.match(/F(\d)/)?.[1] ?? 0);
  const v = pct ? value * 100 : value;
  return (fmt.startsWith('I') ? Math.round(v) : v.toFixed(digits)).toString().replace('.', dec) + (pct ? '%' : '');
}
function scaling(promote, dec) {
  const levels = Array.from({ length: 15 }, (_, i) => promote[i + 1]);
  if (levels.some((l) => !l)) throw new Error('у таланта не 15 уровней');
  return levels[0].description.flatMap((label, row) => {
    if (!label) return [];
    const name = text(label.split('|')[0]);
    const values = levels.map(({ description, params }) => {
      const [, template = ''] = description[row].split('|');
      return text(template).replace(/\{param(\d+):([A-Z0-9]+)\}/g, (_, p, f) => {
        const v = params[p - 1];
        return v === undefined ? '?' : formatParam(v, f, dec);
      });
    });
    return [{ name, values }];
  });
}

function talents(data, dec) {
  const list = Object.keys(data.talent).sort((a, b) => a - b).map((k) => data.talent[k]);
  // У части персонажей среди активных талантов есть пустые служебные записи без уровней
  const active = list.filter((t) => t.type === 0 && Object.keys(t.promote ?? {}).length);
  const burst = list.find((t) => t.type === 1);
  if (active.length !== 2 || !burst) throw new Error(`${data.name}: неожиданный набор талантов`);
  const plain = (t) => ({ name: t.name, description: text(t.description), icon: asset(t.icon) });
  const fight = (t) => ({ ...plain(t), scaling: scaling(t.promote, dec) });
  return {
    normal: fight(active[0]), skill: fight(active[1]), burst: fight(burst),
    passives: list.filter((t) => t.type === 2).map(plain),
  };
}

function stats(data, curve) {
  const prop = Object.fromEntries(data.upgrade.prop.map((p) => [p.propType, p]));
  const base = (type, level, added) => prop[type].initValue * curve[level.replace('+', '')].curveInfos[prop[type].type] + (added[type] ?? 0);
  const sub = data.specialProp;
  return LEVELS.map(([level, promote]) => {
    const added = data.upgrade.promote[promote].addProps ?? {};
    const value = (added[sub] ?? 0) + (SUB_BASE[sub] ?? 0);
    return {
      level,
      hp: round(base('FIGHT_PROP_BASE_HP', level, added), 0),
      atk: round(base('FIGHT_PROP_BASE_ATTACK', level, added), 0),
      def: round(base('FIGHT_PROP_BASE_DEFENSE', level, added), 0),
      sub: FLAT.has(sub) ? round(value, 0) : round(value * 100, 1),
    };
  });
}

function record(data, { slug, version }, code, en, curve, existing) {
  const element = ELEMENTS[data.element];
  const weapon = WEAPONS[data.weaponType];
  const substat = SUBSTATS[data.specialProp]?.[code];
  if (!element || !weapon || !substat) throw new Error(`${slug}: неизвестные стихия, оружие или стат`);
  const sameElement = existing.find((c) => c.element === element && !c.slug.startsWith('traveler-'));
  const sameWeapon = existing.find((c) => c.weapon === weapon);
  const face = data.icon.replace('UI_AvatarIcon_', '');
  return {
    id: data.id, slug, nameEn: en.name, name: data.name,
    title: text(data.fetter.title), description: text(data.fetter.detail),
    rarity: data.rank, element, elementText: sameElement.elementText, weapon, weaponText: sameWeapon.weaponText,
    region: data.fetter.native, constellationName: data.fetter.constellation,
    birthday: birthday(data.birthday, code), substat, version,
    icon: asset(data.icon), card: asset(`${data.icon}_Card`), splash: asset(`UI_Gacha_AvatarImg_${face}`), emblem: null,
    stats: stats(data, curve), substatPercent: !FLAT.has(data.specialProp),
    talents: talents(data, DEC[code]),
    constellations: Object.keys(data.constellation).sort((a, b) => a - b).map((k) => {
      const c = data.constellation[k];
      return { name: c.name, description: text(c.description), icon: asset(c.icon) };
    }),
  };
}

const cost = (coin, items) => [[MORA, coin], ...Object.entries(items).map(([id, count]) => [Number(id), count])];
function levelup(data) {
  const normal = data.talent[0].promote;
  return {
    asc: [1, 2, 3, 4, 5, 6].map((n) => cost(data.upgrade.promote[n].coinCost, data.upgrade.promote[n].costItems)),
    talents: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => cost(normal[n].coinCost, normal[n].costItems)),
  };
}

const load = (code) => JSON.parse(readFileSync(new URL(FILES[code], OUT), 'utf8'));
const fetchAll = async (id) => {
  const [ru, en, es] = await Promise.all(['ru', 'en', 'es'].map((code) => json(`${API}/${code}/avatar/${id}`)));
  return { ru, en, es };
};

// Сравнение с данными genshin-db на персонаже, который есть в обоих источниках
async function check(curve) {
  const langs = await fetchAll(CONTROL.id);
  const problems = [];
  const same = (label, a, b) => {
    const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
    if (x === y) return;
    let at = 0;
    while (x[at] === y[at]) at++;
    problems.push(`${label}\n  amber:   ${x.slice(Math.max(at - 40, 0), at + 80)}\n  genshin: ${y.slice(Math.max(at - 40, 0), at + 80)}`);
  };
  for (const code of ['ru', 'en', 'es']) {
    const existing = load(code);
    const want = existing.find((c) => c.slug === CONTROL.slug);
    const got = record(langs[code], CONTROL, code, langs.en, curve, existing);
    for (const k of ['id', 'nameEn', 'name', 'title', 'rarity', 'element', 'elementText', 'weapon', 'weaponText', 'region', 'constellationName', 'birthday', 'substat', 'substatPercent', 'stats']) same(`${code} ${k}`, got[k], want[k]);
    for (const k of ['normal', 'skill', 'burst']) {
      same(`${code} ${k} name`, got.talents[k].name, want.talents[k].name);
      same(`${code} ${k} description`, got.talents[k].description, want.talents[k].description);
      same(`${code} ${k} scaling`, got.talents[k].scaling, want.talents[k].scaling);
    }
    for (const [label, a, b] of [['passive', got.talents.passives, want.talents.passives], ['constellation', got.constellations, want.constellations]]) {
      same(`${code} ${label} count`, a.length, b.length);
      a.forEach((item, i) => {
        same(`${code} ${label} ${i} name`, item.name, b[i]?.name);
        same(`${code} ${label} ${i} description`, item.description, b[i]?.description);
      });
    }
  }
  const data = JSON.parse(readFileSync(LEVELUP, 'utf8'));
  const sorted = (steps) => steps.map((s) => [...s].sort((a, b) => a[0] - b[0]));
  const got = levelup(langs.ru);
  const want = data.characters[CONTROL.slug];
  same('levelup asc', sorted(got.asc), sorted(want.asc));
  same('levelup talents', sorted(got.talents), sorted(want.talents));
  return problems;
}

const curve = await json(`${API}/static/avatarCurve`);

if (process.argv.includes('--check')) {
  const problems = await check(curve);
  for (const p of problems) console.log(p);
  console.log(`расхождений с genshin-db: ${problems.length}`);
  process.exit(problems.length ? 1 : 0);
}

// Сначала всё собираем и проверяем: при ошибке ни один файл не меняется
const fetched = [];
for (const c of CHARACTERS) fetched.push({ c, langs: await fetchAll(c.id) });

const output = {};
for (const code of ['ru', 'en', 'es']) {
  const list = load(code);
  for (const { c, langs } of fetched) {
    const item = record(langs[code], c, code, langs.en, curve, list);
    const at = list.findIndex((x) => x.id === item.id || x.slug === item.slug);
    if (at >= 0) list[at] = item;
    else list.push(item);
  }
  output[code] = list.sort((a, b) => a.name.localeCompare(b.name, code));
}

const urls = new Set(output.ru.filter((c) => CHARACTERS.some((x) => x.slug === c.slug)).flatMap((c) => [
  c.icon, c.card, c.splash,
  ...[c.talents.normal, c.talents.skill, c.talents.burst, ...c.talents.passives, ...c.constellations].map((t) => t.icon),
]));
for (const url of urls) {
  const r = await fetch(url, { method: 'HEAD', headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
}

const data = JSON.parse(readFileSync(LEVELUP, 'utf8'));
const nearest = (id) => Object.keys(data.materials).filter((k) => Number(k) < 900000)
  .sort((a, b) => Math.abs(a - id) - Math.abs(b - id))[0];
for (const { c, langs } of fetched) {
  const steps = levelup(langs.ru);
  data.characters[c.slug] = steps;
  for (const id of new Set([...steps.asc, ...steps.talents].flat().map(([x]) => x))) {
    if (data.materials[id]) continue;
    const item = langs.ru.items[id];
    data.materials[id] = {
      rarity: item.rank, sort: data.materials[nearest(id)]?.sort ?? 0, icon: asset(item.icon),
      ru: item.name, en: langs.en.items[id].name, es: langs.es.items[id].name,
    };
  }
}
// Заглушки материалов из утечки больше никому не нужны
for (const [id, m] of Object.entries(data.materials)) {
  if (CHARACTERS.some((c) => String(m.icon).startsWith(`/img/beta/${c.slug}-`))) delete data.materials[id];
}

for (const code of ['ru', 'en', 'es']) writeFileSync(new URL(FILES[code], OUT), JSON.stringify(output[code]));
writeFileSync(LEVELUP, JSON.stringify(data));
console.log(`Amber: ${CHARACTERS.map((c) => c.slug).join(', ')}`);

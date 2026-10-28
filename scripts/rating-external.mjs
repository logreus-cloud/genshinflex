import { mkdir, readFile, writeFile } from 'node:fs/promises';

const cacheDir = new URL('../.cache/rating/external/', import.meta.url);
const output = new URL('../src/data/rating-external.json', import.meta.url);
const prydwenUrl = 'https://www.prydwen.gg/genshin-impact/tier-list';
const wotpackUrl = 'https://wotpack.ru/genshin-impact-top-20-luchshih-personazhej/';
const cached = process.argv.includes('--cached');
const userAgent = 'GenshinFlex-rating (+https://github.com/logreus-cloud/genshinflex)';
let lastPrydwenRequest = 0;

async function page(url, name) {
  const file = new URL(name, cacheDir);
  if (cached) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      throw new Error(`Нет кэша ${name}; запустите сбор без --cached`);
    }
  }
  if (new URL(url).hostname === 'www.prydwen.gg') {
    const wait = 10_000 - (Date.now() - lastPrydwenRequest);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastPrydwenRequest = Date.now();
  }
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': userAgent } });
  } catch (error) {
    throw new Error(`Не удалось скачать ${url}: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Не удалось скачать ${url}: HTTP ${response.status}`);
  const html = await response.text();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, html);
  return html;
}

function prydwen(html) {
  const result = {};
  const roles = { dps: 'carry', 'sub-dps': 'subdps', support: 'support' };
  const allowed = new Set(['T0', 'T0.5', 'T1', 'T1.5', 'T2', 'T3', 'T4', 'T5']);
  for (const block of html.split('<div class="custom-tier tier-').slice(1)) {
    const tier = block.match(/<div class="tier-rating[^"]*"><span>([^<]+)</)?.[1];
    if (!allowed.has(tier)) continue;
    for (const part of block.split('<div class="custom-tier-burst ').slice(1)) {
      const role = roles[part.match(/^([a-z- ]+)"/)?.[1]];
      if (!role) continue;
      for (const card of part.split('<div class="pw-card avatar-card">').slice(1)) {
        const slug = card.match(/href="\/genshin-impact\/characters\/([^"]+)"/)?.[1];
        if (slug) (result[slug] ??= {})[role] = tier;
      }
    }
  }
  return result;
}

const norm = (value) => value.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
const alias = {
  криогг: 'traveler-cryo', пиропутешественник: 'traveler-pyro',
  путешественникдендро: 'traveler-dendro', путешественникэлектро: 'traveler-electro',
  путешественникгео: 'traveler-geo', путешественниканемо: 'traveler-anemo',
  путешественникгидро: 'traveler-hydro', сегунрайденбаал: 'raiden-shogun',
  странникскарамучча: 'wanderer', кириллчудомировичфлинс: 'flins',
  камин: 'gaming', кандакия: 'candace', ягода: 'jahoda', иллуги: 'illuga',
  сиджвин: 'sigewinne', шеврез: 'chevreuse', невиллет: 'neuvillette',
  лоэн: 'lohen', эола: 'eula', тиори: 'chiori', сара: 'kujou-sara',
  кукисинобу: 'kuki-shinobu', аратакиитто: 'arataki-itto',
  сиканоинхэйдзо: 'shikanoin-heizou',
};

function wotpack(html, characters) {
  const clean = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const lines = clean.replace(/<(h[1-4]|tr|li|p)[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ').split('\n').map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => /^Персонажи ранга S\+$/.test(line));
  const end = lines.findIndex((line, index) => index > start && /^Система тир-листа$/.test(line));
  if (start < 0 || end < 0) throw new Error('WotPack: не найдены границы тир-листа');
  const byName = new Map(characters.map((character) => [norm(character.name), character.slug]));
  const result = {};
  const missing = [];
  let tier = null;
  for (const line of lines.slice(start, end)) {
    const heading = line.match(/^Персонажи (?:ранга )?([SABCD]\+?)(?:-ранга)?$/);
    if (heading) { tier = heading[1]; continue; }
    const slug = byName.get(norm(line)) ?? alias[norm(line)];
    if (slug && tier) result[slug] = tier;
    else missing.push(line);
  }
  if (missing.length) console.warn(`WotPack: не сопоставлены ${missing.join(' | ')}`);
  return result;
}

function team(html, slug) {
  const start = html.indexOf('<div class="team-chart-row source-team-row');
  if (start < 0) return null;
  const end = html.indexOf('<div class="team-chart-value team-percent-value"', start);
  if (end < 0) return null;
  const row = html.slice(start, end);
  const members = [...row.matchAll(/class="team-member-card[^"]*" href="\/genshin-impact\/characters\/([^"]+)"/g)].map((match) => match[1]);
  const title = row.match(/<div class="team-chart-meta">[\s\S]*?<strong>([^<]+)<\/strong>/)?.[1]
    ?.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
  if (members.length !== 4 || !title) return null;
  return { members, title, url: `https://www.prydwen.gg/genshin-impact/characters/${slug}` };
}

try {
  const [prydwenHtml, wotpackHtml, characters, rating] = await Promise.all([
    page(prydwenUrl, 'prydwen-tier-list.html'), page(wotpackUrl, 'wotpack-tier-list.html'),
    readFile(new URL('../src/data/generated/characters.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../src/data/rating.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  const prydwenTiers = prydwen(prydwenHtml);
  const wotpackTiers = wotpack(wotpackHtml, characters);
  if (Object.keys(prydwenTiers).length < 50) throw new Error('Prydwen: найдено меньше 50 персонажей');
  if (Object.keys(wotpackTiers).length < 50) throw new Error('WotPack: найдено меньше 50 персонажей');
  const previous = await readFile(output, 'utf8').then(JSON.parse, () => ({}));
  const teams = {};
  for (const slug of Object.keys(prydwenTiers).sort()) {
    const stats = rating.characters[slug];
    if (stats?.carry || stats?.subdps || stats?.support) continue;
    let found = null;
    try {
      found = team(await page(`https://www.prydwen.gg/genshin-impact/characters/${slug}`, `team-${slug}.html`), slug);
    } catch (error) {
      // Команды необязательны: при недоступной странице оставляем команду из прошлого сбора
      if (previous.teams?.[slug]) teams[slug] = previous.teams[slug];
      console.warn(`Prydwen: страница ${slug} недоступна (${error.message})`);
      continue;
    }
    if (found) teams[slug] = found;
    else console.warn(`Prydwen: не найдена команда ${slug}`);
  }
  const sorted = (entries) => Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const result = {
    _meta: { date: new Date().toISOString().slice(0, 10), sources: {
      prydwen: { title: 'Prydwen: тир-лист', url: prydwenUrl },
      wotpack: { title: 'WotPack: тир-лист 7.1', url: wotpackUrl },
    } },
    prydwen: sorted(prydwenTiers), wotpack: sorted(wotpackTiers), teams: sorted(teams),
  };
  await writeFile(output, `${JSON.stringify(result, null, 1)}\n`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

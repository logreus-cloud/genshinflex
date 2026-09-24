// Ищет гайды сообщества на другие сайты и добавляет их в поле external билдов (блок «Также можете посмотреть»).
// Сейчас — краткие гайды KeqingMains (keqingmains.com/q/<имя>-quickguide/): адрес подбираем по имени
// и проверяем, что заголовок страницы действительно про этого персонажа. Уже добавленные ссылки не трогаем.
// Запуск: node scripts/find-external-guides.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const chars = JSON.parse(readFileSync('src/data/generated/characters.en.json', 'utf8'));
const words = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/[\s-]+/).filter(Boolean);

async function kqm(c) {
  const w = words(c.nameEn.replace(/\(.*\)/, ''));
  const tries = [...new Set([w.join('-'), w.at(-1), w[0], w.slice(-2).join('-')])];
  for (const name of tries) {
    const url = `https://keqingmains.com/q/${name}-quickguide/`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) continue;
    const title = (await res.text()).match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
    if (w.some((x) => x.length > 2 && title.toLowerCase().includes(x))) return url;
  }
  return null;
}

let added = 0;
for (const file of readdirSync('src/content/builds')) {
  const path = `src/content/builds/${file}`;
  const md = readFileSync(path, 'utf8');
  if (/^external:/m.test(md)) continue;
  const c = chars.find((x) => x.slug === file.replace(/\.md$/, ''));
  if (!c || c.slug.startsWith('traveler-')) continue;
  const url = await kqm(c);
  if (!url) { console.log(`— ${c.slug}: не нашли`); continue; }
  // Сохраняем переводы строк файла, чтобы в git менялись только добавленные строки
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const block = ['external:', '  - title: "KeqingMains Quick Guide"', `    url: ${url}`, '    author: KQM', '    lang: en', ''].join(eol);
  // Вставляем перед закрывающей чертой frontmatter
  const end = md.indexOf(`${eol}---`, 3) + eol.length;
  writeFileSync(path, `${md.slice(0, end)}${block}${md.slice(end)}`);
  added++;
  console.log(`✓ ${c.slug}: ${url}`);
}
console.log(`добавлено ссылок: ${added}`);

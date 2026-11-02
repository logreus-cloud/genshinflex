import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Хост должен совпадать с site в astro.config.mjs.
const HOST = 'genshinflex.com';
const KEY = '90da48263ca1b469ee7ca29aaad23e2d';
const DIST = resolve('dist');
const PENDING = resolve('.cache/indexnow-pending.json');

function localFile(url, page = false) {
  const parts = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error(`Недопустимый URL: ${url}`);
  return resolve(DIST, ...parts, ...(page ? ['index.html'] : []));
}

function locations(xml) {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].trim().replace(/&amp;/g, '&'));
}

async function sitemapUrls() {
  const seen = new Set();
  const pages = new Set();
  async function visit(sitemapUrl) {
    if (seen.has(sitemapUrl)) return;
    seen.add(sitemapUrl);
    const xml = await readFile(localFile(sitemapUrl), 'utf8');
    for (const location of locations(xml)) {
      const url = new URL(location, sitemapUrl);
      if (url.host !== HOST) continue;
      if (/<sitemapindex\b/i.test(xml)) await visit(url.href);
      else pages.add(url.href);
    }
  }
  await visit(`https://${HOST}/sitemap.xml`);
  return [...pages].sort();
}

function visibleHash(html) {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha1').update(text).digest('hex');
}

async function oldManifest() {
  try {
    const response = await fetch(`https://${HOST}/indexnow-manifest.json`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return {};
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !Object.values(data).every((hash) => typeof hash === 'string')) return {};
    return data;
  } catch {
    return {};
  }
}

async function prepare() {
  const manifest = {};
  for (const url of await sitemapUrls()) {
    let html;
    try {
      html = await readFile(localFile(url, true), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    manifest[url] = visibleHash(html);
  }
  await writeFile(resolve(DIST, 'indexnow-manifest.json'), JSON.stringify(manifest));
  const previous = await oldManifest();
  const changed = Object.keys(manifest).filter((url) => manifest[url] !== previous[url]);
  await mkdir(dirname(PENDING), { recursive: true });
  await writeFile(PENDING, JSON.stringify(changed));
  console.log(`IndexNow: изменено ${changed.length} из ${Object.keys(manifest).length}`);
}

async function submit() {
  let pending;
  try {
    pending = JSON.parse(await readFile(PENDING, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('IndexNow: нечего отправлять');
    return;
  }
  if (!Array.isArray(pending)) throw new Error('Некорректный список IndexNow');
  if (pending.length === 0) {
    console.log('IndexNow: нечего отправлять');
    return;
  }
  let sent = 0;
  for (let i = 0; i < pending.length; i += 10_000) {
    const urlList = pending.slice(i, i + 10_000);
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
      // Зависший ответ не должен держать CI: таймаут действует и на чтение тела
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status !== 200 && response.status !== 202) {
      console.error(`IndexNow: ошибка ${response.status}: ${await response.text()}`);
      process.exitCode = 1;
      return;
    }
    sent += urlList.length;
  }
  await unlink(PENDING);
  console.log(`IndexNow: отправлено ${sent}`);
}

if (process.argv[2] === 'prepare') await prepare();
else if (process.argv[2] === 'submit') await submit();
else throw new Error('Укажите prepare или submit');

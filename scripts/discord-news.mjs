import { readFile, mkdir, writeFile, rename, open, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import { store } from './cms/store.mjs';

try { process.loadEnvFile('.env'); } catch {}

// Общий канал site-news: новость уходит одним сообщением на трёх языках
const webhook = process.env.DISCORD_WEBHOOK_NEWS;
if (!webhook) {
  console.log('Discord: вебхук новостей не задан, пропускаю');
} else {
  const dry = process.argv.includes('--dry');
  let stateFile = '.cache/discord-news.json';
  let sharedState = false;
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    stateFile = resolve(process.cwd(), commonDir, 'genshinflex', 'discord-news.json');
    sharedState = true;
  } catch {
    console.warn('Discord: git недоступен, использую .cache/discord-news.json');
  }
  console.log(`Discord: состояние — ${stateFile}`);
  const clip = (value, limit) => {
    const chars = Array.from(value);
    return chars.length <= limit ? value : `${chars.slice(0, limit - 1).join('')}…`;
  };

  async function news() {
    const allFiles = await store.listEntries('news');
    const files = allFiles.filter((id) => id.startsWith('ru/'));
    const items = await Promise.all(files.map(async (file) => {
      const source = (await store.readEntry('news', file)).text;
      if (!/^---\r?\n/.test(source)) throw new Error(`Нет frontmatter: ${file}`);
      const data = matter(source, { engines: { yaml: (text) => YAML.parse(text) } }).data;
      if (data.draft === true) return null;
      if (typeof data.anchor !== 'string' || !data.anchor.trim() || !data.title || !data.summary || !data.date || Number.isNaN(Date.parse(data.date)))
        throw new Error(`Неполные данные новости: ${file}`);
      return { ...data, file, date: new Date(data.date).toISOString() };
    }));
    return { items: items.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date)), files: new Set(allFiles) };
  }

  async function readPosted(file) {
    const state = JSON.parse(await readFile(file, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Неверный формат состояния Discord');
    for (const key of ['posted', 'en', 'es']) {
      if (key in state && (!Array.isArray(state[key]) || !state[key].every((anchor) => typeof anchor === 'string')))
        throw new Error('Неверный формат состояния Discord');
    }
    if (!('posted' in state)) throw new Error('Неверный формат состояния Discord');
    return state;
  }

  async function save(state) {
    await mkdir(dirname(stateFile), { recursive: true });
    // Пишем во временный файл и переименовываем: прерванная запись не оставит битый JSON
    const temporary = `${stateFile}.${process.pid}.tmp`;
    const output = Object.fromEntries(Object.entries(state).map(([key, anchors]) => [key, anchors instanceof Set ? [...anchors] : anchors]));
    await writeFile(temporary, JSON.stringify(output, null, 2) + '\n');
    await rename(temporary, stateFile);
  }

  async function lockState() {
    const lockFile = `${stateFile}.lock`;
    await mkdir(dirname(stateFile), { recursive: true });
    try {
      return await open(lockFile, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      console.log(`Discord: публикация уже идёт или прошлый запуск упал — пропускаю. Если других деплоев нет, удалите ${lockFile}`);
      return null;
    }
  }

  async function translation(item, lang, files) {
    if (lang === 'ru') return item;
    const file = `${lang}/${item.file.slice(3)}`;
    if (!files.has(file)) { console.warn(`Discord (${lang}): нет перевода ${file}`); return null; }
    let data;
    try { data = matter((await store.readEntry('news', file)).text, { engines: { yaml: (text) => YAML.parse(text) } }).data; }
    catch { console.warn(`Discord (${lang}): неверный перевод ${file}`); return null; }
    if (data.draft === true || typeof data.title !== 'string' || !data.title.trim() || typeof data.summary !== 'string' || !data.summary.trim()) { console.warn(`Discord (${lang}): неполный перевод ${file}`); return null; }
    return { ...item, title: data.title, summary: data.summary };
  }

  async function publish() {
    const { items, files } = await news();
    let initialized = false;
    let state;
    try {
      state = await readPosted(stateFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      initialized = true;
      state = { posted: [] };
      let migrated = 0;
      if (sharedState) {
        let worktrees = [];
        try {
          const listed = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8' });
          worktrees = listed.split('\0')
            .filter((field) => field.startsWith('worktree '))
            .map((field) => field.slice('worktree '.length));
        } catch {
          console.warn('Discord: не удалось получить список worktree, проверяю только текущий каталог');
        }
        const oldFiles = [...new Set([process.cwd(), ...worktrees].map((root) => resolve(root, '.cache/discord-news.json')))];
        for (const file of oldFiles) {
          try {
            const previous = await readPosted(file);
            for (const key of ['posted', 'en', 'es']) {
              if (!(key in previous)) continue;
              state[key] ??= [];
              for (const anchor of previous[key]) if (!state[key].includes(anchor)) state[key].push(anchor);
            }
            migrated++;
          } catch (oldError) {
            if (oldError.code !== 'ENOENT') console.warn(`Discord: пропускаю неверное состояние ${file}: ${oldError.message}`);
          }
        }
      }
      if (migrated) console.log(`Discord: перенёс состояние из ${migrated} старых файлов`);
      else state.posted = items.slice(0, -1).map((item) => item.anchor);
    }
    // Ключи en/es от прежних отдельных каналов сохраняются в файле как есть, но больше не используются
    const posted = new Set(state.posted);
    state.posted = posted;
    if (initialized && !dry) await save(state);
    const role = process.env.DISCORD_NEWS_ROLE_ID?.trim();
    const mention = role && /^\d+$/.test(role) ? role : null;
    const footers = { ru: 'GenshinFlex · новости сайта', en: 'GenshinFlex · site news', es: 'GenshinFlex · noticias del sitio' };
    const label = 'Новое на сайте · New on the site · Novedades en el sitio';
    const pending = items.filter((item) => !posted.has(item.anchor));
    if (!pending.length) console.log('Discord: новых новостей нет');
    for (const item of pending) {
      // Одна новость — одно сообщение в общем канале: RU и готовые переводы EN/ES
      const versions = [];
      for (const lang of ['ru', 'en', 'es']) {
        const localized = await translation(item, lang, files);
        if (localized) versions.push([lang, localized]);
      }
      // Discord: не больше 6000 символов на все embed-ы сообщения
      const budget = Math.floor(5600 / versions.length);
      const embeds = versions.map(([lang, localized]) => {
        const title = clip(localized.title, 256);
        return {
          title,
          description: clip(localized.summary, Math.max(200, Math.min(4096, budget - Array.from(title).length - footers[lang].length))),
          url: `https://genshinflex.com/${lang === 'ru' ? '' : `${lang}/`}news/#${encodeURIComponent(item.anchor)}`,
          color: 0xE3B04B,
          timestamp: item.date,
          footer: { text: footers[lang] },
        };
      });
      const body = {
        username: 'GenshinFlex',
        content: mention ? `<@&${mention}> ${label}` : label,
        allowed_mentions: mention ? { parse: [], roles: [mention] } : { parse: [] },
        embeds,
      };
      const languages = versions.map(([lang]) => lang).join('/');
      if (dry) {
        console.log(`Discord: отправил бы «${item.title}» (${languages})`);
        continue;
      }
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // Зависший Discord не должен держать деплой, который уже выложен
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Discord: HTTP ${response.status} для «${item.title}»`);
      posted.add(item.anchor);
      await save(state);
      console.log(`Discord: опубликовано «${item.title}» (${languages})`);
    }
  }

  if (dry) {
    await publish();
  } else {
    const lock = await lockState();
    const locked = lock !== null;
    if (locked) {
      try {
        await lock.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
        await publish();
      } finally {
        try {
          await lock.close();
        } finally {
          try {
            await unlink(`${stateFile}.lock`);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
      }
    }
  }
}

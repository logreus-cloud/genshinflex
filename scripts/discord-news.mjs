import { readFile, mkdir, writeFile, rename, open, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import { store } from './cms/store.mjs';

try { process.loadEnvFile('.env'); } catch {}

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
    const files = (await store.listEntries('news')).filter((id) => id.startsWith('ru/'));
    const items = await Promise.all(files.map(async (file) => {
      const source = (await store.readEntry('news', file)).text;
      if (!/^---\r?\n/.test(source)) throw new Error(`Нет frontmatter: ${file}`);
      const data = matter(source, { engines: { yaml: (text) => YAML.parse(text) } }).data;
      if (data.draft === true) return null;
      if (typeof data.anchor !== 'string' || !data.anchor.trim() || !data.title || !data.summary || !data.date || Number.isNaN(Date.parse(data.date)))
        throw new Error(`Неполные данные новости: ${file}`);
      return { ...data, date: new Date(data.date).toISOString() };
    }));
    return items.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  }

  async function readPosted(file) {
    const state = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(state.posted) || !state.posted.every((anchor) => typeof anchor === 'string'))
      throw new Error('Неверный формат состояния Discord');
    return state.posted;
  }

  async function save(posted) {
    await mkdir(dirname(stateFile), { recursive: true });
    // Пишем во временный файл и переименовываем: прерванная запись не оставит битый JSON
    const temporary = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ posted: [...posted] }, null, 2) + '\n');
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

  async function publish() {
    const items = await news();
    let firstRun = false;
    let posted;
    try {
      posted = new Set(await readPosted(stateFile));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      posted = new Set();
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
            for (const anchor of await readPosted(file)) posted.add(anchor);
            migrated++;
          } catch (oldError) {
            if (oldError.code !== 'ENOENT') console.warn(`Discord: пропускаю неверное состояние ${file}: ${oldError.message}`);
          }
        }
      }
      if (migrated) {
        console.log(`Discord: перенёс состояние из ${migrated} старых файлов`);
        if (!dry) await save(posted);
      } else {
        firstRun = true;
        posted = new Set(items.slice(0, -1).map((item) => item.anchor));
      }
    }

    const pending = firstRun ? items.slice(-1) : items.filter((item) => !posted.has(item.anchor));
    if (!pending.length) console.log('Discord: новых новостей нет');
    for (const item of pending) {
      const role = process.env.DISCORD_NEWS_ROLE_ID?.trim();
      const mention = role && /^\d+$/.test(role) ? role : null;
      const body = {
        username: 'GenshinFlex',
        content: mention ? `<@&${mention}> Новое на сайте` : 'Новое на сайте',
        allowed_mentions: mention ? { parse: [], roles: [mention] } : { parse: [] },
        embeds: [{
          title: clip(item.title, 256),
          description: clip(item.summary, 4096),
          url: `https://genshinflex.com/news/#${encodeURIComponent(item.anchor)}`,
          color: 0xE3B04B,
          timestamp: item.date,
          footer: { text: 'GenshinFlex · новости сайта' },
        }],
      };
      if (dry) {
        console.log(`Discord: отправил бы «${item.title}»`);
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
      await save(posted);
      console.log(`Discord: опубликовано «${item.title}»`);
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

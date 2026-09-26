import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import matter from 'gray-matter';
import YAML from 'yaml';
import { store } from './cms/store.mjs';

try { process.loadEnvFile('.env'); } catch {}

const webhook = process.env.DISCORD_WEBHOOK_NEWS;
if (!webhook) {
  console.log('Discord: вебхук новостей не задан, пропускаю');
} else {
  const dry = process.argv.includes('--dry');
  const stateFile = '.cache/discord-news.json';
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
      if (!data.anchor || !data.title || !data.summary || !data.date || Number.isNaN(Date.parse(data.date)))
        throw new Error(`Неполные данные новости: ${file}`);
      return { ...data, date: new Date(data.date).toISOString() };
    }));
    return items.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  }

  async function publish() {
    const items = await news();
    let firstRun = false;
    let posted;
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      if (!Array.isArray(state.posted) || !state.posted.every((anchor) => typeof anchor === 'string'))
        throw new Error('Неверный формат состояния Discord');
      posted = new Set(state.posted);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      firstRun = true;
      posted = new Set(items.slice(0, -1).map((item) => item.anchor));
    }

    const pending = firstRun ? items.slice(-1) : items.filter((item) => !posted.has(item.anchor));
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
      await mkdir('.cache', { recursive: true });
      // Пишем во временный файл и переименовываем: прерванная запись не оставит битый JSON
      await writeFile(`${stateFile}.tmp`, JSON.stringify({ posted: [...posted] }, null, 2) + '\n');
      await rename(`${stateFile}.tmp`, stateFile);
      console.log(`Discord: опубликовано «${item.title}»`);
    }
  }

  await publish();
}

import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

try { process.loadEnvFile('.env'); } catch {}

const webhook = process.env.DISCORD_WEBHOOK_NEWS;
if (!webhook) {
  console.log('Discord: вебхук новостей не задан, пропускаю');
} else {
  const dry = process.argv.includes('--dry');
  const directory = 'src/content/news/ru';
  const stateFile = '.cache/discord-news.json';
  const clip = (value, limit) => {
    const chars = Array.from(value);
    return chars.length <= limit ? value : `${chars.slice(0, limit - 1).join('')}…`;
  };

  async function news() {
    const files = (await readdir(directory)).filter((file) => file.endsWith('.md'));
    const items = await Promise.all(files.map(async (file) => {
      const source = await readFile(join(directory, file), 'utf8');
      const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      if (!frontmatter) throw new Error(`Нет frontmatter: ${file}`);
      const data = Object.fromEntries(frontmatter.split(/\r?\n/).map((line) => {
        const match = line.match(/^([a-z]+):\s*(.*)$/);
        if (!match) return [];
        const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        return [match[1], value];
      }).filter((entry) => entry.length));
      if (!data.anchor || !data.title || !data.summary || !data.date || Number.isNaN(Date.parse(data.date)))
        throw new Error(`Неполные данные новости: ${file}`);
      return { ...data, date: new Date(data.date).toISOString() };
    }));
    return items.sort((a, b) => a.date.localeCompare(b.date));
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

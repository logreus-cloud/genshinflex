// Тихий деплой: вместо простыни логов — луна-спиннер по шагам. Полный лог показываем, только если шаг упал.
// Подробный вывод по-старому: npm run deploy:verbose
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// --sanity — контент из Sanity (CONTENT_SOURCE=sanity); токен чтения SANITY_READ_TOKEN — из .env (в .gitignore)
if (process.argv.includes('--sanity')) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  process.env.CONTENT_SOURCE = 'sanity';
  if (!process.env.SANITY_READ_TOKEN) {
    console.error('Для сборки из Sanity нужен SANITY_READ_TOKEN');
    process.exit(1);
  }
}

const MOON = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
const tty = process.stdout.isTTY;
const time = (ms) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)} с` : `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`);

function step(label, command) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let log = '';
    let frame = 0, done = 0;
    // Astro печатает по строке «├─ /путь» на каждый готовый файл — считаем их как прогресс
    const paint = () => process.stdout.write(`\r${MOON[frame++ % MOON.length]} ${label}… ${time(Date.now() - start)}${done ? ` · файлов: ${done}` : ''}   `);
    const timer = tty ? setInterval(paint, 120) : null;
    if (!tty) console.log(`… ${label}`);
    const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } });
    child.stdout.on('data', (d) => { log += d; done += (String(d).match(/[├└]─/g) ?? []).length; });
    child.stderr.on('data', (d) => { log += d; });
    // Обычно ждём close (весь вывод дочитан); если трубы держат фоновые процессы — выходим через 2 с после exit
    let finished = false;
    child.on('close', (code) => finish(code));
    child.on('exit', (code) => setTimeout(() => finish(code), 2000).unref());
    function finish(code) {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      const took = time(Date.now() - start);
      if (code === 0) {
        process.stdout.write(`${tty ? '\r' : ''}✅ ${label} — ${took}          \n`);
        resolve(log);
      } else {
        process.stdout.write(`${tty ? '\r' : ''}❌ ${label} — ошибка после ${took}\n\n`);
        console.log(log.split('\n').slice(-60).join('\n'));
        reject(new Error(`${label}: код ${code}`));
      }
    }
  });
}

// --test — тестовая версия: отдельная ветка Cloudflare Pages с постоянным адресом test.genshinflex.pages.dev,
// основной сайт не трогается. База D1 общая с основным сайтом — отзывы с теста попадут в ту же админку.
// --branch=<имя> — своя ветка Pages с адресом <имя>.genshinflex.pages.dev (например, platform — чтобы не затирать тестовый дизайн)
const branchArg = process.argv.find((arg) => arg.startsWith('--branch='))?.slice('--branch='.length);
const branch = branchArg || (process.argv.includes('--test') ? 'test' : '');
// --branch=main — это основной сайт (так выкладывает CI), не тестовая версия
const test = Boolean(branch) && branch !== 'main';
const total = Date.now();
try {
  const build = await step('Собираю сайт', 'npx astro build');
  const pages = build.match(/(\d+) page\(s\) built/)?.[1];
  if (pages) console.log(`   📄 страниц: ${pages}`);
  await step('Индексирую поиск', 'npx pagefind --site dist');
  const out = await step(test ? 'Выкладываю тестовую версию' : 'Выкладываю на Cloudflare', `npx wrangler pages deploy dist --project-name genshinflex${branch ? ` --branch ${branch}` : ''}`);
  const url = out.match(/https:\/\/\S+\.pages\.dev\S*/)?.[0];
  // Публикация новостей из Sanity в Discord — отдельная задача.
  if (!test && !process.argv.includes('--no-discord')) {
    try {
      await step('Публикую новости в Discord', 'node --import tsx scripts/discord-news.mjs');
    } catch {
      console.warn('⚠️ Новости в Discord не опубликованы');
    }
  }
  console.log(`\n🌙 Готово за ${time(Date.now() - total)}${url ? ` — ${url}` : ''}`);
} catch {
  process.exitCode = 1;
}

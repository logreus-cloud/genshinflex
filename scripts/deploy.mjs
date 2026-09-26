// Тихий деплой: вместо простыни логов — луна-спиннер по шагам. Полный лог показываем, только если шаг упал.
// Подробный вывод по-старому: npm run deploy:verbose
import { spawn } from 'node:child_process';

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
const test = process.argv.includes('--test');
const total = Date.now();
try {
  const build = await step('Собираю сайт', 'npx astro build');
  const pages = build.match(/(\d+) page\(s\) built/)?.[1];
  if (pages) console.log(`   📄 страниц: ${pages}`);
  await step('Индексирую поиск', 'npx pagefind --site dist');
  const out = await step(test ? 'Выкладываю тестовую версию' : 'Выкладываю на Cloudflare', `npx wrangler pages deploy dist --project-name genshinflex${test ? ' --branch test' : ''}`);
  const url = out.match(/https:\/\/\S+\.pages\.dev\S*/)?.[0];
  if (!test) {
    try {
      await step('Публикую новости в Discord', 'node scripts/discord-news.mjs');
    } catch {
      console.warn('⚠️ Новости в Discord не опубликованы');
    }
  }
  console.log(`\n🌙 Готово за ${time(Date.now() - total)}${url ? ` — ${url}` : ''}`);
} catch {
  process.exitCode = 1;
}

// Запускайте перед заменой текущего цикла новым. В проде текущий цикл живёт в Sanity — локальный JSON должен быть актуален.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const [mode, ...args] = process.argv.slice(2);
  if (!['abyss', 'theater', 'onslaught'].includes(mode)) {
    throw new Error('Укажите режим: abyss, theater или onslaught.');
  }

  const options = {};
  for (const arg of args) {
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    const match = arg.match(/^--(from|version|phase)=(.+)$/);
    if (!match) throw new Error(`Неизвестный аргумент: ${arg}`);
    options[match[1]] = match[2];
  }

  const source = resolve(options.from ?? `src/content/rotations/${mode}-current.json`);
  const data = JSON.parse(readFileSync(source, 'utf8'));
  if (data.mode !== mode) throw new Error(`Режим в файле (${data.mode}) не совпадает с аргументом (${mode}).`);
  if (data.draft === true) throw new Error('Черновик архивировать нельзя.');

  const version = options.version ?? data.cycle?.match(/Версия\s+(\d+\.\d+)/)?.[1];
  if (!version) {
    throw new Error(mode === 'theater'
      ? 'Для Театра укажите версию через --version=X.Y: в названии сезона её нет.'
      : 'Не удалось определить версию из cycle. Укажите --version=X.Y.');
  }
  if (!/^\d+\.\d+$/.test(version)) throw new Error('Версия должна иметь вид X.Y.');

  const phase = options.phase === undefined ? undefined : Number(options.phase);
  if (phase !== undefined && ![1, 2].includes(phase)) throw new Error('Фаза должна быть 1 или 2.');

  if (typeof data.start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.start)
    || Number.isNaN(Date.parse(`${data.start}T00:00:00Z`))
    || new Date(`${data.start}T00:00:00Z`).toISOString().slice(0, 10) !== data.start) {
    throw new Error('Поле start должно быть датой YYYY-MM-DD.');
  }
  if (typeof data.cycle !== 'string' || typeof data.end !== 'string') {
    throw new Error('В файле нужны строковые поля cycle и end.');
  }

  const destination = resolve(`src/content/rotations-archive/${mode}/${data.start}.json`);
  if (existsSync(destination) && !options.force) {
    throw new Error(`Файл уже существует: ${destination}. Для замены добавьте --force.`);
  }

  const { mode: _mode, version: _version, phase: _phase, cycle, start, end, ...rest } = data;
  const archived = { mode, version, ...(phase === undefined ? {} : { phase }), cycle, start, end, ...rest };
  mkdirSync(resolve(`src/content/rotations-archive/${mode}`), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(archived, null, 2)}\n`);
  console.log(`Цикл сохранён: ${destination}`);
} catch (error) {
  console.error(`Ошибка архивации: ${error.message}`);
  process.exitCode = 1;
}

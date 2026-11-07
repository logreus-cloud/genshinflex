// Карточки персонажей для /characters: официальная карточка молитвы с enka (UI_Gacha_AvatarIcon, 320×1024);
// если её нет (путешественник, бета) — вырезка 2:5 из сплэш-арта
// от макушки примерно до пояса, голова по центру → public/img/chars/<slug>.webp.
// У всех карточек rembg вырезает персонажа, фон заменяется градиентом по редкости.
// Путешественник чередуется Люмин/Итер по порядку в списке.
// Точки лиц — src/data/char-card-faces.json ([x, y, размер лица] в долях арта; найдены детектором аниме-лиц и поправлены вручную).
// Сплэши беты берутся из public/img/beta/<slug>-splash.webp. Уже готовые не трогаем; --force — пересоздать все.
// Для вырезания нужен rembg (scripts/cut-char-cards.py; pip install rembg[cpu]).
// Промежуточные файлы — .cache/char-cards.
// Запуск: node scripts/import-char-cards.mjs [--force] [--only=slug1,slug2]
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public/img/chars');
const cropDir = path.join(root, '.cache/char-cards/crop');
const cutDir = path.join(root, '.cache/char-cards/cut');
const readyDir = path.join(root, '.cache/char-cards/ready');
const force = process.argv.includes('--force');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;
const characters = JSON.parse(await fs.readFile(path.join(root, 'src/data/generated/characters.json'), 'utf8'));
const beta = JSON.parse(await fs.readFile(path.join(root, 'src/data/beta-characters.json'), 'utf8')).characters;
const released = Array.isArray(characters) ? characters : Object.values(characters);
const releasedSlugs = new Set(released.map((c) => c.slug));
const list = [
  ...released,
  // Бета без сплэша (утечка без арта) пропускается; вышедшего персонажа берём из основных данных
  ...beta.filter((b) => !releasedSlugs.has(b.slug)).map((b) => ({ slug: b.slug, rarity: b.rarity, splash: path.join(root, `public/img/beta/${b.slug}-splash.webp`) })).filter((b) => existsSync(b.splash)),
];
const faces = JSON.parse(await fs.readFile(path.join(root, 'src/data/char-card-faces.json'), 'utf8'));
await fs.mkdir(out, { recursive: true });
// Только кадры текущего запуска: Python режет всё, что лежит в папке
await fs.rm(cropDir, { recursive: true, force: true });
await fs.mkdir(cropDir, { recursive: true });
await fs.rm(readyDir, { recursive: true, force: true });
await fs.mkdir(readyDir, { recursive: true });

const W = 320, H = 800;
// Без точки лица: доля высоты фигуры в кадре (≈ от макушки до пояса) и отступ над макушкой
const SHARE = .62, HEADROOM = .04;
// С точкой лица: лицо ≈ 15% высоты карточки, его центр — на 20% от верха
const FACE_SHARE = .15, FACE_Y = .2;
const have = [];
let made = 0, failed = 0;
const tasks = [];
let traveler = 0;

function background(rarity, width, height) {
  const [top, bottom] = Number(rarity) === 5 ? ['#7a5226', '#d1953f'] : ['#5b4b82', '#9679c4'];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="base" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop stop-color="${top}"/><stop offset="100%" stop-color="${bottom}"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#base)"/>
    </svg>`);
}

// Контур фигуры и центр головы по альфа-каналу (на уменьшенной копии)
async function figure(buffer, width, height) {
  const sw = 512, sh = Math.round(512 * height / width);
  const { data } = await sharp(buffer).resize(sw, sh, { fit: 'fill' }).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  const rows = [];
  for (let y = 0; y < sh; y++) {
    let n = 0;
    for (let x = 0; x < sw; x++) if (data[y * sw + x] > 40) n++;
    rows.push(n);
  }
  const top = rows.findIndex((n) => n > 2);
  const bottom = sh - 1 - [...rows].reverse().findIndex((n) => n > 2);
  if (top < 0) return null;
  // Голова — взвешенный центр непрозрачных пикселей в верхней части фигуры
  const band = top + Math.round((bottom - top) * .22);
  let sum = 0, weight = 0;
  for (let y = top; y <= band; y++) {
    for (let x = 0; x < sw; x++) {
      const a = data[y * sw + x];
      if (a > 40) { sum += x * a; weight += a; }
    }
  }
  const k = width / sw;
  return { top: top * k, bottom: bottom * k, headX: (weight ? sum / weight : sw / 2) * k };
}

async function load(src) {
  if (/^https?:/.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new Error(String(response.status));
    return Buffer.from(await response.arrayBuffer());
  }
  return fs.readFile(src);
}

for (const c of list) {
  const aether = c.slug.startsWith('traveler-') && traveler++ % 2 === 1;
  const file = path.join(out, `${c.slug}.webp`);
  if (only && !only.has(c.slug)) {
    if (await fs.stat(file).then(() => true, () => false)) have.push(c.slug);
    continue;
  }
  if (!force && !only && await fs.stat(file).then(() => true, () => false)) { have.push(c.slug); continue; }
  // Официальная карточка молитвы (320×1024) — кадр 2:5 по центру делает CSS.
  // Вырезка из сплэша — только когда карточки нет (404); при сбое сети оставляем старый файл
  if (c.icon?.includes('UI_AvatarIcon_')) {
    const response = await fetch(c.icon.replace('UI_AvatarIcon_', 'UI_Gacha_AvatarIcon_'), {
      headers: { 'User-Agent': 'GenshinFlex' },
    }).catch((error) => error);
    if (response instanceof Error || (!response.ok && response.status !== 404)) {
      failed++;
      console.warn(`\n${c.slug}: карточка недоступна (${response instanceof Error ? response.message : response.status})`);
      if (await fs.stat(file).then(() => true, () => false)) have.push(c.slug);
      continue;
    }
    if (response.ok) {
      try {
        await sharp(Buffer.from(await response.arrayBuffer()))
          .resize({ width: W }).png().toFile(path.join(cropDir, `${c.slug}.png`));
        tasks.push({ slug: c.slug, rarity: c.rarity, file, width: W, height: 1024 });
      } catch (error) {
        failed++;
        console.warn(`\n${c.slug}: карточка не скачалась (${error.message})`);
        if (await fs.stat(file).then(() => true, () => false)) have.push(c.slug);
      }
      continue;
    }
  }
  const splash = aether ? c.splash?.replace('PlayerGirl', 'PlayerBoy') : c.splash;
  if (!splash) continue;
  try {
    const buffer = await load(splash);
    const meta = await sharp(buffer).metadata();
    let cropH, centerX, top;
    const face = aether ? faces['traveler-aether'] : faces[c.slug];
    if (face) {
      const [fx, fy, size] = face;
      cropH = Math.round(Math.min(meta.height, Math.max(size * meta.height / FACE_SHARE, meta.height * .5)));
      centerX = fx * meta.width;
      top = Math.round(fy * meta.height - cropH * FACE_Y);
    } else {
      const fig = await figure(buffer, meta.width, meta.height);
      if (!fig) throw new Error('пустой арт');
      cropH = Math.round(Math.min(meta.height, Math.max((fig.bottom - fig.top) * SHARE, meta.height * .45)));
      centerX = fig.headX;
      top = Math.max(0, Math.round(fig.top - cropH * HEADROOM));
    }
    const cropW = Math.round(cropH * 2 / 5);
    // Поля вокруг арта, чтобы кадр мог выйти за край (там прозрачность)
    const pad = cropH;
    const left = Math.round(centerX - cropW / 2) + pad;
    top += pad;
    const padded = await sharp(buffer).ensureAlpha()
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    // Сплэш с прозрачным фоном уже вырезан — rembg на нём только портит фигуру (тёмная одежда, маленький кадр)
    const transparent = !(await sharp(buffer).stats()).isOpaque;
    const crop = path.join(transparent ? readyDir : cropDir, `${c.slug}.png`);
    await sharp(padded).extract({ left, top, width: cropW, height: cropH }).png().toFile(crop);
    tasks.push({ slug: c.slug, rarity: c.rarity, file, width: W, height: H, cut: transparent ? crop : undefined });
  } catch (error) {
    failed++;
    console.warn(`\n${c.slug}: ${error.message}`);
    // Старая карточка остаётся на диске — не выкидываем её из индекса
    if (await fs.stat(file).then(() => true, () => false)) have.push(c.slug);
  }
}

if (tasks.some((task) => !task.cut)) {
  // Готовые вырезки не удаляем: cut-char-cards.py пропускает их по отпечатку
  await fs.mkdir(cutDir, { recursive: true });
  const result = spawnSync('python', ['scripts/cut-char-cards.py', cropDir, cutDir], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('Не удалось запустить сегментацию: установите rembg командой pip install rembg[cpu]');
  }
}

for (const { slug, rarity, file, width, height, cut: ready } of tasks) {
  const cut = ready ?? path.join(cutDir, `${slug}.png`);
  try {
    if (!existsSync(cut)) throw new Error('нет вырезанного персонажа');
    const cutout = await sharp(cut).resize(width, height).png().toBuffer();
    await sharp(background(rarity, width, height)).composite([{ input: cutout }])
      .removeAlpha().webp({ quality: 82, effort: 6 }).toFile(file);
    have.push(slug);
    made++;
    process.stdout.write(`${slug} `);
  } catch (error) {
    failed++;
    console.warn(`\n${slug}: ${error.message}`);
    // Старая карточка остаётся на диске — не выкидываем её из индекса
    if (await fs.stat(file).then(() => true, () => false)) have.push(slug);
  }
}
await fs.writeFile(path.join(root, 'src/data/generated/char-cards.json'), JSON.stringify([...new Set(have)].sort()));
console.log(`\nготово: новых ${made}, всего ${have.length}, ошибок ${failed}`);
if (failed > 0) process.exitCode = 1;

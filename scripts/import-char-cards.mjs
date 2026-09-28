// Вертикальные карточки персонажей для списка /characters: портретная вырезка из сплэш-арта (прозрачный фон)
// от макушки примерно до пояса, голова по центру → public/img/chars/<slug>.webp (320×640).
// Точки лиц — src/data/char-card-faces.json ([x, y, размер лица] в долях арта; найдены детектором аниме-лиц и поправлены вручную).
// Сплэши беты берутся из public/img/beta/<slug>-splash.webp. Уже готовые не трогаем; --force — пересоздать все.
// Запуск: node scripts/import-char-cards.mjs [--force]
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public/img/chars');
const force = process.argv.includes('--force');
const characters = JSON.parse(await fs.readFile(path.join(root, 'src/data/generated/characters.json'), 'utf8'));
const beta = JSON.parse(await fs.readFile(path.join(root, 'src/data/beta-characters.json'), 'utf8')).characters;
const list = [
  ...(Array.isArray(characters) ? characters : Object.values(characters)),
  ...beta.map((b) => ({ slug: b.slug, splash: path.join(root, `public/img/beta/${b.slug}-splash.webp`) })),
];
const faces = JSON.parse(await fs.readFile(path.join(root, 'src/data/char-card-faces.json'), 'utf8'));
await fs.mkdir(out, { recursive: true });

const W = 320, H = 640;
// Без точки лица: доля высоты фигуры в кадре (≈ от макушки до пояса) и отступ над макушкой
const SHARE = .62, HEADROOM = .04;
// С точкой лица: лицо ≈ 15% высоты карточки, его центр — на 20% от верха
const FACE_SHARE = .15, FACE_Y = .2;
const have = [];
let made = 0, failed = 0;

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
  const file = path.join(out, `${c.slug}.webp`);
  if (!force && await fs.stat(file).then(() => true, () => false)) { have.push(c.slug); continue; }
  if (!c.splash) continue;
  try {
    const buffer = await load(c.splash);
    const meta = await sharp(buffer).metadata();
    let cropH, centerX, top;
    const face = faces[c.slug];
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
    const cropW = Math.round(cropH / 2);
    // Поля вокруг арта, чтобы кадр мог выйти за край (там прозрачность)
    const pad = cropH;
    const left = Math.round(centerX - cropW / 2) + pad;
    top += pad;
    const padded = await sharp(buffer).ensureAlpha()
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    await sharp(padded).extract({ left, top, width: cropW, height: cropH })
      .resize(W, H).webp({ quality: 80, alphaQuality: 80, effort: 6 }).toFile(file);
    have.push(c.slug);
    made++;
    process.stdout.write(`${c.slug} `);
  } catch (error) {
    failed++;
    console.warn(`\n${c.slug}: ${error.message}`);
  }
}
await fs.writeFile(path.join(root, 'src/data/generated/char-cards.json'), JSON.stringify([...new Set(have)].sort()));
console.log(`\nготово: новых ${made}, всего ${have.length}, ошибок ${failed}`);

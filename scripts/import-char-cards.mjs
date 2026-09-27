// Вертикальные карточки персонажей для списка /characters: вырезка из сплэш-арта (2048×1024, прозрачный фон)
// по центру фигуры → public/img/chars/<slug>.webp (256×512). Уже готовые не трогаем; --force — пересоздать все.
// Запуск: node scripts/import-char-cards.mjs [--force]
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public/img/chars');
const force = process.argv.includes('--force');
const characters = JSON.parse(await fs.readFile(path.join(root, 'src/data/generated/characters.json'), 'utf8'));
const list = Array.isArray(characters) ? characters : Object.values(characters);
await fs.mkdir(out, { recursive: true });

const W = 256, H = 512;
const have = [];
let made = 0, failed = 0;

// Центр фигуры по X: взвешенный центр непрозрачных пикселей в верхних 70% кадра (там голова и корпус)
async function figureCenter(buffer) {
  const { data, info } = await sharp(buffer).resize(256, 128, { fit: 'fill' }).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  let sum = 0, weight = 0;
  for (let y = 0; y < Math.round(info.height * 0.7); y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[y * info.width + x];
      if (a > 40) { sum += x * a; weight += a; }
    }
  }
  return weight ? sum / weight / info.width : 0.5;
}

for (const c of list) {
  const file = path.join(out, `${c.slug}.webp`);
  if (!force && await fs.stat(file).then(() => true, () => false)) { have.push(c.slug); continue; }
  if (!c.splash || !/^https?:/.test(c.splash)) continue;
  try {
    const response = await fetch(c.splash);
    if (!response.ok) throw new Error(String(response.status));
    const buffer = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const center = await figureCenter(buffer);
    // Кадр 1:2 во всю высоту арта, по центру фигуры, не выходя за края
    const cropW = Math.round(meta.height / 2);
    const left = Math.max(0, Math.min(meta.width - cropW, Math.round(center * meta.width - cropW / 2)));
    await sharp(buffer).extract({ left, top: 0, width: cropW, height: meta.height })
      .resize(W, H).webp({ quality: 78, alphaQuality: 80, effort: 6 }).toFile(file);
    have.push(c.slug);
    made++;
    process.stdout.write(`${c.slug} `);
  } catch (error) {
    failed++;
    console.warn(`\n${c.slug}: ${error.message}`);
  }
}
await fs.writeFile(path.join(root, 'src/data/generated/char-cards.json'), JSON.stringify(have.sort()));
console.log(`\nготово: новых ${made}, всего ${have.length}, ошибок ${failed}`);

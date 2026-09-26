// Намкарты персонажей для фона баннеров.
import { readFileSync, writeFileSync } from 'node:fs';
import genshin from 'genshin-db';

const OUT = new URL('../src/data/generated/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('characters.json', OUT), 'utf8'));
const characters = Array.isArray(source) ? source : Object.values(source);
const backgrounds = new Map();

for (const name of genshin.namecards('names', { matchCategories: true })) {
  const images = genshin.namecards(name)?.images;
  if (images?.filename_icon && images.filename_background) {
    backgrounds.set(images.filename_icon, images.filename_background);
  }
}

const namecards = {};
for (const character of characters) {
  const avatar = character.icon?.match(/(?:^|\/)UI_AvatarIcon_([^/.]+)\.png(?:\?.*)?$/)?.[1];
  const background = avatar && backgrounds.get(`UI_NameCardIcon_${avatar}`);
  if (character.slug && background) namecards[character.slug] = `https://enka.network/ui/${background}.png`;
}

const sorted = Object.fromEntries(Object.entries(namecards).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
writeFileSync(new URL('namecards.json', OUT), JSON.stringify(sorted, null, 1) + '\n');
console.log(`namecards: ${Object.keys(sorted).length}`);

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const src = new URL('../../src/', import.meta.url);
const ui = JSON.parse(readFileSync(new URL('i18n/ui.json', src), 'utf8'));
// Словарь контента собирается так же, как в src/i18n/index.ts: шаблонные переводы, поверх — ручные
const contentAuto = JSON.parse(readFileSync(new URL('i18n/content-auto.json', src), 'utf8'));
const contentManual = JSON.parse(readFileSync(new URL('i18n/content.manual.json', src), 'utf8'));
const content = Object.fromEntries(['en', 'es'].map((lang) => [lang, {
  ...contentAuto[lang], ...Object.fromEntries(Object.entries(contentManual).map(([ru, value]) => [ru, value[lang]])),
}]));

test('ручные переводы контента полны и сохраняют плейсхолдеры', () => {
  const broken = Object.entries(contentManual).filter(([ru, value]) => ['en', 'es'].some((lang) =>
    typeof value?.[lang] !== 'string' || !value[lang].trim()
    || JSON.stringify(placeholders(value[lang])) !== JSON.stringify(placeholders(ru))));
  assert.deepEqual(broken.map(([ru]) => ru), []);
});
function placeholders(value) { return [...new Set(value.match(/\{\w+\}/g) ?? [])].sort(); }
const cyrillic = /[А-Яа-яЁё]/;

function extractKeys(source) {
  const keys = [];
  let dynamic = 0;
  for (const match of source.matchAll(/\bt\(\s*/g)) {
    const start = match.index + match[0].length;
    const quote = source[start];
    if (!["'", '"', '`'].includes(quote)) { dynamic++; continue; }

    let end = start + 1;
    let interpolated = false;
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue; }
      if (quote === '`' && source.startsWith('${', end)) interpolated = true;
      if (source[end] === quote) break;
      end++;
    }
    // Литерал должен быть всем первым аргументом: t('а' + name) или t('а'.repeat(2)) — уже выражение
    const next = source.slice(end + 1).match(/^\s*(.)/s)?.[1];
    if (end >= source.length || interpolated || (next !== ',' && next !== ')')) { dynamic++; continue; }
    try { keys.push(new Function(`return ${source.slice(start, end + 1)}`)()); }
    catch { dynamic++; }
  }
  return { keys, dynamic };
}

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
  return entry.isDirectory() ? files(path) : /\.(astro|ts)$/.test(entry.name) ? [path] : [];
});

test('извлечение ключей t()', () => {
  const source = [
    "t('один')",
    't("два")',
    't(`три`)',
    't(`значение ${x}`)',
    't(name)',
    String.raw`t('\'')`,
    String.raw`t("\"")`,
    String.raw`t('\n')`,
    String.raw`t('\ж')`,
    String.raw`t('ж\u{436}')`,
    "t( 'а' )",
    "t('б' + name)",
    't("в".repeat(2))',
    "t('г', { n })",
    "format('x')",
    "alt('x')",
  ].join('\n');
  assert.deepEqual(extractKeys(source), {
    keys: ['один', 'два', 'три', "'", '"', '\n', 'ж', 'жж', 'а', 'г'],
    dynamic: 4,
  });
});

test('словарь интерфейса', () => {
  const errors = [];
  for (const [key, row] of Object.entries(ui)) {
    for (const lang of ['en', 'es']) {
      const value = row?.[lang];
      if (typeof value !== 'string' || !value.trim()) errors.push(`${lang}: пустой перевод: ${key}`);
      else if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(key)))
        errors.push(`${lang}: не совпадают плейсхолдеры: ${key}`);
    }
  }

  const check = (source, path, client) => {
    for (const key of extractKeys(source).keys) {
      if (!cyrillic.test(key)) continue;
      const inContent = ['en', 'es'].every((lang) => typeof content[lang][key] === 'string' && content[lang][key].trim());
      if (!ui[key] && (client || !inContent)) errors.push(`${path}: нет перевода: ${key}`);
    }
  };
  for (const file of files(src)) {
    const source = readFileSync(file, 'utf8');
    const path = file.href.replace(src.href, 'src/');
    if (file.pathname.endsWith('.astro')) {
      const scripts = [...source.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(([block]) => block);
      for (const script of scripts) check(script, path, true);
      check(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''), path, false);
    } else check(source, path, file.href.startsWith(new URL('scripts/', src).href));
  }
  assert.deepEqual(errors, [], errors.join('\n'));
});

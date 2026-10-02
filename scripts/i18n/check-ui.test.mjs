import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const src = new URL('../../src/', import.meta.url);
const ui = JSON.parse(readFileSync(new URL('i18n/ui.json', src), 'utf8'));
const content = Object.fromEntries(['en', 'es'].map((lang) => [
  lang, JSON.parse(readFileSync(new URL(`i18n/content.${lang}.json`, src), 'utf8')),
]));
const placeholders = (value) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
const cyrillic = /[А-Яа-яЁё]/;
const translations = /\bt\('((?:[^'\\]|\\.)*)'/g;

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
  return entry.isDirectory() ? files(path) : /\.(astro|ts)$/.test(entry.name) ? [path] : [];
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
    for (const [, raw] of source.matchAll(translations)) {
      const key = raw.replace(/\\'/g, "'");
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

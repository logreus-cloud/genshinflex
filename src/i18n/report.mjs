// Интеграция Astro: после сборки сохраняет непереведённые строки в .i18n-missing.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ui = JSON.parse(readFileSync(new URL('./ui.json', import.meta.url), 'utf8'));
const literals = new Set();
const scan = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) scan(path);
    else if (/\.(astro|ts)$/.test(entry.name)) {
      const source = readFileSync(path, 'utf8');
      for (const [, key] of source.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) literals.add(key.replace(/\\'/g, "'"));
    }
  }
};
scan(new URL('../', import.meta.url));

export default function i18nReport() {
  return {
    name: 'i18n-report',
    hooks: {
      'astro:build:done': ({ logger }) => {
        const missing = globalThis.__i18nMissing ?? {};
        const out = {};
        for (const [lang, keys] of Object.entries(missing)) {
          for (const key of keys) {
            const kind = Object.hasOwn(ui, key) || literals.has(key) ? 'interface' : 'content';
            ((out[kind] ??= {})[lang] ??= []).push(key);
          }
        }
        for (const translations of Object.values(out)) {
          for (const keys of Object.values(translations)) keys.sort();
        }
        writeFileSync('.i18n-missing.json', JSON.stringify(out, null, 1));
        for (const [kind, translations] of Object.entries(out)) {
          for (const [lang, keys] of Object.entries(translations)) logger.warn(`${kind} ${lang}: без перевода ${keys.length} строк — см. .i18n-missing.json`);
        }
        if (process.env.I18N_STRICT === '1' && out.interface) throw new Error(`Без переводов интерфейса: ${Object.values(out.interface).flat().join(', ')}`);
      },
    },
  };
}

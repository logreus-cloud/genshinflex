// Интеграция Astro: после сборки сохраняет непереведённые строки в .i18n-missing.json
import { writeFileSync } from 'node:fs';

export default function i18nReport() {
  return {
    name: 'i18n-report',
    hooks: {
      'astro:build:done': ({ logger }) => {
        const missing = globalThis.__i18nMissing ?? {};
        const out = Object.fromEntries(Object.entries(missing).map(([l, s]) => [l, [...s].sort()]));
        writeFileSync('.i18n-missing.json', JSON.stringify(out, null, 1));
        for (const [l, list] of Object.entries(out)) if (list.length) logger.warn(`${l}: без перевода ${list.length} строк — см. .i18n-missing.json`);
      },
    },
  };
}

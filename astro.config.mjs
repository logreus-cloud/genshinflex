// @ts-check
import { defineConfig } from 'astro/config';
import i18nReport from './src/i18n/report.mjs';

// https://astro.build/config
export default defineConfig({
  // Боевой адрес: из него строятся canonical, og:url и sitemap. При переезде на свой домен поменять здесь.
  site: 'https://genshinflex.com',
  // Русский — в корне, английский и испанский — /en/ и /es/
  i18n: { defaultLocale: 'ru', locales: ['ru', 'en', 'es'], routing: { prefixDefaultLocale: false } },
  integrations: [i18nReport()],
});

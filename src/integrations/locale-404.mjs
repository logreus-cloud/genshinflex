import { existsSync, renameSync, rmdirSync } from 'node:fs';

export default function locale404() {
  let locales;

  return {
    name: 'locale-404',
    hooks: {
      'astro:config:done': ({ config }) => {
        locales = config.i18n.locales.filter((locale) => locale !== config.i18n.defaultLocale);
      },
      'astro:build:done': ({ dir }) => {
        const root = new URL('404.html', dir);
        const rootIndex = new URL('404/index.html', dir);
        if (existsSync(rootIndex)) {
          renameSync(rootIndex, root);
          rmdirSync(new URL('404/', dir));
        }
        if (!existsSync(root)) throw new Error('Не найдена корневая страница 404.html');

        for (const locale of locales) {
          const source = new URL(`${locale}/404/index.html`, dir);
          const target = new URL(`${locale}/404.html`, dir);
          if (!existsSync(source)) {
            throw new Error(`Не найдена страница 404 для языка ${locale}: ${source.pathname}`);
          }
          renameSync(source, target);
          rmdirSync(new URL(`${locale}/404/`, dir));
        }
      },
    },
  };
}

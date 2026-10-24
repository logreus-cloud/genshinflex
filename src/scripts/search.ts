// Поиск по названиям (свой индекс) + полнотекстовый по гайдам (Pagefind, есть только после сборки).
import type { Entry } from './common';

type Index = {
  characters: { s: string; n: string; e: string; el: string; w: string; r: number; i: string | null; b: number }[];
  weapons: { s: string; n: string; e: string; w: string; r: number; i: string | null }[];
  artifacts: { s: string; n: string; e: string; r: number; i: string | null }[];
  pages: [string, string][];
};

import { pageLang, translate } from '../i18n/client';
// Префикс ссылок по языку страницы: '' | '/en' | '/es'. Серверные функции (/api/…) живут в корне — для них префикс не нужен.
export const LANG = pageLang();
export const BASE = LANG === 'ru' ? '' : `/${LANG}`;
export const t = translate(LANG);
// Клиентская навигация может сменить язык без перезагрузки модуля: язык и кеши — на каждый вызов
const current = () => {
  const lang = pageLang();
  return { lang, base: lang === 'ru' ? '' : `/${lang}`, t: translate(lang) };
};
const indexes = new Map<string, Promise<Index>>();
export const loadIndex = (): Promise<Index> => {
  const { base } = current();
  let promise = indexes.get(base);
  if (!promise) {
    promise = fetch(`${base}/data/index.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<Index>;
    });
    // Неудачную загрузку не кешируем, чтобы следующий поиск попробовал снова
    promise.catch(() => { if (indexes.get(base) === promise) indexes.delete(base); });
    indexes.set(base, promise);
  }
  return promise;
};

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const score = (q: string, ...fields: string[]) => {
  let best = 0;
  for (const f of fields.map(norm)) {
    if (f.startsWith(q)) best = Math.max(best, 3);
    else if (f.split(/[\s-]+/).some((w) => w.startsWith(q))) best = Math.max(best, 2);
    else if (f.includes(q)) best = Math.max(best, 1);
  }
  return best;
};

export async function searchNames(query: string, limit = 8): Promise<Entry[]> {
  const q = norm(query.trim());
  if (!q) return [];
  const { base: BASE, t } = current();
  const idx = await loadIndex();
  const found: (Entry & { score: number })[] = [
    ...idx.characters.map((c) => ({ score: score(q, c.n, c.e) + 0.3, href: `${BASE}/characters/${c.s}`, name: c.n, icon: c.i, kind: t('Персонаж') })),
    ...idx.weapons.map((w) => ({ score: score(q, w.n, w.e), href: `${BASE}/weapons/${w.s}`, name: w.n, icon: w.i, kind: t('Оружие') })),
    ...idx.artifacts.map((a) => ({ score: score(q, a.n, a.e), href: `${BASE}/artifacts#${a.s}`, name: a.n, icon: a.i, kind: t('Артефакты') })),
    ...idx.pages.map(([n, h]) => ({ score: score(q, t(n)), href: `${BASE}${h}`, name: t(n), icon: null, kind: t('Раздел') })),
  ];
  return found.filter((x) => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Pagefind подключается через import() в обход Vite — файлы появляются только в dist
type PagefindResult = { data: () => Promise<{ url: string; meta: { title?: string }; excerpt: string }> };
type Pagefind = { search: (q: string) => Promise<{ results: PagefindResult[] }> };
const pagefinds = new Map<string, Promise<Pagefind | null>>();
const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<Pagefind>;

export async function searchText(query: string, limit = 5) {
  const { base } = current();
  let pagefind = pagefinds.get(base);
  if (!pagefind) {
    pagefind = dynamicImport(`${base}/pagefind/pagefind.js`).catch(() => {
      pagefinds.delete(base);
      return null;
    });
    pagefinds.set(base, pagefind);
  }
  const pf = await pagefind;
  if (!pf || !query.trim()) return [];
  const { results } = await pf.search(query);
  return Promise.all(results.slice(0, limit).map((r) => r.data()));
}

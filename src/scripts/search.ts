// Поиск по названиям (свой индекс) + полнотекстовый по гайдам (Pagefind, есть только после сборки).
import type { Entry } from './common';

type Index = {
  characters: { s: string; n: string; e: string; el: string; w: string; r: number; i: string | null; b: number }[];
  weapons: { s: string; n: string; e: string; w: string; r: number; i: string | null }[];
  artifacts: { s: string; n: string; e: string; r: number; i: string | null }[];
  pages: [string, string][];
};

export const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, '');
let indexPromise: Promise<Index> | null = null;
export const loadIndex = () => (indexPromise ??= fetch(`${BASE}/data/index.json`).then((r) => r.json()));

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
  const idx = await loadIndex();
  const found: (Entry & { score: number })[] = [
    ...idx.characters.map((c) => ({ score: score(q, c.n, c.e) + 0.3, href: `${BASE}/characters/${c.s}`, name: c.n, icon: c.i, kind: 'Персонаж' })),
    ...idx.weapons.map((w) => ({ score: score(q, w.n, w.e), href: `${BASE}/weapons/${w.s}`, name: w.n, icon: w.i, kind: 'Оружие' })),
    ...idx.artifacts.map((a) => ({ score: score(q, a.n, a.e), href: `${BASE}/artifacts#${a.s}`, name: a.n, icon: a.i, kind: 'Артефакты' })),
    ...idx.pages.map(([n, h]) => ({ score: score(q, n), href: `${BASE}${h}`, name: n, icon: null, kind: 'Раздел' })),
  ];
  return found.filter((x) => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Pagefind подключается через import() в обход Vite — файлы появляются только в dist
type PagefindResult = { data: () => Promise<{ url: string; meta: { title?: string }; excerpt: string }> };
let pagefind: Promise<{ search: (q: string) => Promise<{ results: PagefindResult[] }> } | null> | null = null;
const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;

export async function searchText(query: string, limit = 5) {
  pagefind ??= dynamicImport(`${BASE}/pagefind/pagefind.js`).catch(() => null);
  const pf = await pagefind;
  if (!pf || !query.trim()) return [];
  const { results } = await pf.search(query);
  return Promise.all(results.slice(0, limit).map((r) => r.data()));
}

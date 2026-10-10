import type { Wish } from './wish-store';

type Idx = { characters: { id: number | null; s: string; n: string; i: string | null; r: number }[]; weapons: { id: number; s: string; n: string; i: string | null; r: number }[] };
export type Group = { key: string; title: string; types: string[]; pity: number; soft: number; fiftyFifty: boolean };
export type Five = { name: string; pity: number; outcome: 'win' | 'lose' | 'guar' | null; time: string };

// Баннер 400 делит гарант с 301.
export const GROUPS: Group[] = [
  { key: 'char', title: 'Событие персонажа', types: ['301', '400'], pity: 90, soft: 74, fiftyFifty: true },
  { key: 'weapon', title: 'Оружие', types: ['302'], pity: 80, soft: 63, fiftyFifty: false },
  { key: 'standard', title: 'Стандартный', types: ['200'], pity: 90, soft: 74, fiftyFifty: false },
  { key: 'chronicled', title: 'Хроники', types: ['500'], pity: 90, soft: 74, fiftyFifty: false },
];

export async function loadWishIndex(base: string, lang: string, signal: AbortSignal) {
  const idx: Idx = await fetch(`${base}/data/checker.json`, { signal }).then((r) => r.json());
  const byName = new Map<string, { i: string | null; kind: 'c' | 'w'; s: string; r?: number }>();
  const byId = new Map<string, { n: string; kind: 'c' | 'w'; r?: number }>();
  // История хранится с русскими именами — для показа переводим через слаг.
  const ruIdx: Idx = lang === 'ru' ? idx : await fetch('/data/checker.json', { signal }).then((r) => r.json());
  const ruNameBySlug = new Map([...ruIdx.characters, ...ruIdx.weapons].map((x) => [x.s, x.n]));
  const slugByRuName = new Map([...ruIdx.characters, ...ruIdx.weapons].map((x) => [x.n.toLowerCase(), x.s]));
  const bySlug = new Map<string, { n: string; i: string | null; kind: 'c' | 'w' }>([
    ...idx.characters.map((c) => [c.s, { n: c.n, i: c.i, kind: 'c' as const }] as const),
    ...idx.weapons.map((w) => [w.s, { n: w.n, i: w.i, kind: 'w' as const }] as const),
  ]);
  // Предмет узнаём по ID или имени на любом языке.
  const namesByLang = await Promise.all(['', '/en', '/es'].map((p) =>
    fetch(`${p}/data/index.json`, { signal }).then((r) => r.json()).catch(() => ({ characters: [], weapons: [] }))));
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const slugOfName = new Map<string, string>(slugByRuName);
  for (const n of namesByLang) for (const x of [...n.characters, ...n.weapons]) slugOfName.set(x.n.toLowerCase(), x.s);
  const slugOfId = new Map([...ruIdx.characters, ...ruIdx.weapons].filter((x) => x.id).map((x) => [String(x.id), x.s]));
  const characterSlugs = new Set(ruIdx.characters.map((c) => c.s));
  const slugOf = (w: { name: string; item_id?: string }) =>
    (w.item_id ? slugOfId.get(String(w.item_id)) : undefined) ?? slugOfName.get(w.name.trim().toLowerCase());
  const shown = (name: string) => { const s = slugOfName.get(name.trim().toLowerCase()); return s && bySlug.has(s) ? { ...bySlug.get(s)!, s } : undefined; };
  for (const c of idx.characters) byName.set(c.n.toLowerCase(), { i: c.i, kind: 'c', s: c.s, r: c.r });
  for (const w of idx.weapons) byName.set(w.n.toLowerCase(), { i: w.i, kind: 'w', s: w.s, r: w.r });
  for (const c of ruIdx.characters) if (c.id) byId.set(String(c.id), { n: c.n, kind: 'c', r: c.r });
  for (const w of ruIdx.weapons) byId.set(String(w.id), { n: w.n, kind: 'w', r: w.r });
  return { idx, byName, byId, ruNameBySlug, slugOf, shown, characterSlugs };
}

export function analyse(list: Wish[], g: Group, ctx: { standard: Set<string>; slugOf: (w: Wish) => string | undefined; characterSlugs: Set<string> }) {
  const ws = list.filter((w) => g.types.includes(w.gacha_type));
  let p5 = 0, p4 = 0, guaranteed = false;
  const fives: Five[] = [];
  const outcomes = new Map<string, Five['outcome']>();
  for (const w of ws) {
    p5++; p4++;
    if (w.rank_type === '5') {
      let outcome: Five['outcome'] = null;
      if (g.fiftyFifty) {
        const slug = ctx.slugOf(w);
        const lost = !!slug && ctx.characterSlugs.has(slug) && ctx.standard.has(slug);
        outcome = lost ? 'lose' : guaranteed ? 'guar' : 'win';
        guaranteed = lost;
      }
      fives.push({ name: w.name, pity: p5, outcome, time: w.time });
      outcomes.set(w.id, outcome);
      p5 = 0; p4 = 0;
    } else if (w.rank_type === '4') p4 = 0;
  }
  const wins = fives.filter((f) => f.outcome === 'win').length, losses = fives.filter((f) => f.outcome === 'lose').length;
  return {
    total: ws.length, p5, p4, guaranteed, fives, outcomes,
    avg: fives.length ? Math.round(fives.reduce((s, f) => s + f.pity, 0) / fives.length) : null,
    rate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : null,
  };
}

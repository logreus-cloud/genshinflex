import type { ExploreTag } from './exploration';

export type Role = 'carry' | 'subdps' | 'support' | 'sustain';
export const ROLES: Role[] = ['carry', 'subdps', 'support', 'sustain'];
export type Tier = 'S' | 'A' | 'B' | 'C';
export type Element = 'pyro' | 'hydro' | 'anemo' | 'electro' | 'dendro' | 'cryo' | 'geo';

export type TeamRow = { id: string; m: string[]; dps: number; targets: number; reaction?: string };
export type RoleStat = { value: number; n: number; best: { id: string; team: string[] } };
export type RatingData = {
  _meta: { date: string; source: string; entries: number; baseline: number; teams: number; shares: number; pairs: number; own: number };
  characters: Record<string, Partial<Record<'carry' | 'subdps' | 'support', RoleStat>>>;
  teams: TeamRow[];
};
export type RatingManual = {
  characters: Record<string, { patch: string; sources: { title: string; url: string }[]; roles: { role: 'carry' | 'subdps' | 'support'; score: number; note?: string; override?: boolean }[] }>;
  sustain: Record<string, { level: 'plenty' | 'enough' | 'low'; kind: 'heal' | 'shield' | 'both'; note?: string }>;
  exploration?: Record<string, ExploreTag[]>;
};
export type SustainLevel = keyof typeof SUSTAIN_SCORE;
export type OverallRow = {
  slug: string; role: Role; value: number | null; score: number; tier: Tier; rank: number;
  kind: 'sim' | 'expert'; source?: { title: string; url: string }; team?: string[]; note?: string;
};
export type ConsLevel = 0 | 1 | 2;
export type VariantKey = '0' | '1' | '2' | '0w' | '1w' | '2w';
export type ConsVariant = { score: number; tier: Tier; rank: number; gain: number | null };

export function variantKey(level: ConsLevel, weapon: boolean): VariantKey {
  return `${level}${weapon ? 'w' : ''}` as VariantKey;
}

export const SUSTAIN_SCORE = { plenty: 90, enough: 75, low: 55 } as const;

export function classifyTeam(
  members: { slug: string; dps: number; fieldTime: number }[],
  teamDps: number,
): Record<string, Exclude<Role, 'sustain'>> {
  const result: Record<string, Exclude<Role, 'sustain'>> = {};
  if (teamDps <= 0) return Object.fromEntries(members.map((member) => [member.slug, 'support']));
  let carry = -1;
  // Керри стоит на поле: урон от реакций (цветение, вегетация) gcsim пишет тому, кто их запустил,
  // поэтому без этого условия в керри попадают Син Цю или Кокоми
  const field = members.reduce((sum, member) => sum + Math.max(0, member.fieldTime), 0);
  for (let i = 0; i < members.length; i++) {
    const share = members[i].dps / teamDps;
    if (field > 0 && members[i].fieldTime / field < 0.3) continue;
    if (share >= 0.35 && (carry < 0 || share > members[carry].dps / teamDps
      || (share === members[carry].dps / teamDps && members[i].fieldTime > members[carry].fieldTime))) carry = i;
  }
  members.forEach((member, i) => {
    result[member.slug] = i === carry ? 'carry' : member.dps / teamDps >= 0.12 ? 'subdps' : 'support';
  });
  return result;
}

export function aggregate(values: number[]): number | null {
  if (!values.length) return null;
  const best = [...values].sort((a, b) => b - a);
  return best.length === 1 ? best[0] : (best[0] + best[1]) / 2;
}

export function swapPairs(teams: TeamRow[], eligible: Set<string>): { a: string; b: string; r: number }[] {
  const groups = new Map<string, { slug: string; dps: number }[]>();
  for (const team of teams) {
    if (team.m.length !== 4 || !Number.isFinite(team.dps) || team.dps <= 0) continue;
    team.m.forEach((slug, i) => {
      if (!eligible.has(slug)) return;
      const other = team.m.filter((_, j) => i !== j).sort();
      const groupKey = JSON.stringify([other, team.targets]);
      const group = groups.get(groupKey) ?? [];
      group.push({ slug, dps: team.dps });
      groups.set(groupKey, group);
    });
  }
  const pairs = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].slug === group[j].slug) continue;
        pairs.push({ a: group[i].slug, b: group[j].slug, r: Math.log(group[i].dps / group[j].dps) });
      }
    }
  }
  return pairs;
}

export function supportStrength(
  pairs: { a: string; b: string; r: number }[], lambda = 2, iterations = 500,
): Record<string, { s: number; n: number }> {
  const nodes = new Map<string, { s: number; edges: { other: string; r: number }[] }>();
  for (const { a, b, r } of pairs) {
    if (!nodes.has(a)) nodes.set(a, { s: 0, edges: [] });
    if (!nodes.has(b)) nodes.set(b, { s: 0, edges: [] });
    nodes.get(a)!.edges.push({ other: b, r });
    nodes.get(b)!.edges.push({ other: a, r: -r });
  }
  for (let i = 0; i < iterations; i++) {
    let change = 0;
    for (const node of nodes.values()) {
      const next = node.edges.reduce((sum, edge) => sum + edge.r + nodes.get(edge.other)!.s, 0)
        / (node.edges.length + lambda);
      change = Math.max(change, Math.abs(next - node.s));
      node.s = next;
    }
    if (change < 1e-9) break;
  }
  return Object.fromEntries([...nodes].map(([slug, node]) => [slug, { s: node.s, n: node.edges.length }]));
}

export function tierOf(score: number): Tier {
  return score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
}

export function scoreRole<T extends { value: number }>(rows: T[]): (T & { score: number; tier: Tier; rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 0;
  let lastScore: number | undefined;
  let rank = 0;
  return sorted.map((row, index) => {
    const score = max > 0 ? Math.round(row.value / max * 100) : 0;
    if (score !== lastScore) rank = index + 1;
    lastScore = score;
    return { ...row, score, tier: tierOf(score), rank };
  });
}

export function simUrl(id: string): string {
  if (id.startsWith('own:'))
    return `https://github.com/logreus-cloud/genshinflex/blob/main/scripts/sim-teams/${encodeURIComponent(id.slice(4))}.txt`;
  return `https://gcsim.app/db/${id}`;
}

export function buildOverall(generated: RatingData, manual: RatingManual): Record<Role, OverallRow[]> {
  const result = {} as Record<Role, OverallRow[]>;
  for (const role of ['carry', 'subdps', 'support'] as const) {
    const sims = Object.entries(generated.characters).flatMap(([slug, stats]) => {
      const stat = stats[role];
      return stat ? [{ slug, ...stat }] : [];
    });
    const rows: OverallRow[] = scoreRole(sims).map((row) => ({
      slug: row.slug,
      role,
      value: row.value,
      score: row.score,
      tier: row.tier,
      rank: row.rank,
      kind: 'sim',
      source: { title: row.best.id.startsWith('own:') ? 'конфиг' : 'gcsim', url: simUrl(row.best.id) },
      team: row.best.team,
    }));
    for (const [slug, character] of Object.entries(manual.characters)) {
      for (const entry of character.roles) {
        if (entry.role !== role) continue;
        const index = rows.findIndex((row) => row.slug === slug);
        if (index >= 0 && !entry.override) continue;
        const source = character.sources[0];
        const row: OverallRow = {
          slug, role, value: null, score: entry.score, tier: tierOf(entry.score), rank: 0,
          kind: 'expert', ...(source ? { source } : {}), ...(entry.note ? { note: entry.note } : {}),
        };
        if (index >= 0) rows[index] = row;
        else rows.push(row);
      }
    }
    rows.sort((a, b) => b.score - a.score);
    let rank = 0;
    result[role] = rows.map((row, index) => {
      if (index === 0 || row.score !== rows[index - 1].score) rank = index + 1;
      return { ...row, rank };
    });
  }
  const sustain = Object.entries(manual.sustain).map(([slug, entry]): OverallRow => ({
    slug, role: 'sustain', value: null, score: SUSTAIN_SCORE[entry.level],
    tier: tierOf(SUSTAIN_SCORE[entry.level]), rank: 0, kind: 'expert',
    ...(entry.note ? { note: entry.note } : {}),
  }));
  sustain.sort((a, b) => b.score - a.score);
  let rank = 0;
  result.sustain = sustain.map((row, index) => {
    if (index === 0 || row.score !== sustain[index - 1].score) rank = index + 1;
    return { ...row, rank };
  });
  return result;
}

export function consVariants(
  rows: OverallRow[],
  gainOf: (slug: string, level: ConsLevel, weapon: boolean) => number | null,
): Map<string, Record<VariantKey, ConsVariant>> {
  const result = new Map<string, Record<VariantKey, ConsVariant>>();
  for (const row of rows) {
    const base = { score: row.score, tier: row.tier, rank: row.rank, gain: null };
    result.set(row.slug, {
      0: base, 1: { ...base }, 2: { ...base },
      '0w': { ...base }, '1w': { ...base }, '2w': { ...base },
    });
  }
  for (const weapon of [false, true]) {
    for (const level of [0, 1, 2] as const) {
      if (level === 0 && !weapon) continue;
      const key = variantKey(level, weapon);
      const adjusted = rows.map((row, index) => {
        const gain = gainOf(row.slug, level, weapon);
        return { slug: row.slug, index, gain, value: row.score * (1 + (gain ?? 0) / 100) };
      });
      const max = Math.max(0, ...adjusted.map((entry) => entry.value));
      const sorted = adjusted.map((entry) => ({
        ...entry, score: max > 0 ? Math.round(entry.value / max * 100) : 0,
      })).sort((a, b) => b.score - a.score || a.index - b.index);
      let rank = 0;
      sorted.forEach((entry, index) => {
        if (index === 0 || entry.score !== sorted[index - 1].score) rank = index + 1;
        result.get(entry.slug)![key] = { score: entry.score, tier: tierOf(entry.score), rank, gain: entry.gain };
      });
    }
  }
  return result;
}

export function fitsAbyssHalf(elements: Element[], need: Element[][]): boolean {
  return need.every((group) => group.some((element) => elements.includes(element)));
}

export function fitsTheater(members: { slug: string; element: Element }[], seasonElements: Element[], cast: string[]): boolean {
  return members.every((member) => seasonElements.includes(member.element) || cast.includes(member.slug));
}

const ELEMENT_RU: Record<Element, string> = {
  pyro: 'Пиро', hydro: 'Гидро', anemo: 'Анемо', electro: 'Электро',
  dendro: 'Дендро', cryo: 'Крио', geo: 'Гео',
};

export function elementFromRu(name: string): Element | null {
  const found = Object.entries(ELEMENT_RU).find(([, ru]) => ru.toLowerCase() === name.trim().toLowerCase());
  return found ? found[0] as Element : null;
}

export function rankTeams(teams: TeamRow[], fits: (t: TeamRow) => boolean, limit = 10): (TeamRow & { score: number; tier: Tier; rank: number })[] {
  return scoreRole(teams.filter(fits).map((team) => ({ ...team, value: team.dps })))
    .slice(0, limit).map(({ value, ...team }) => team);
}

export const REACTION_RU: Record<string, string> = {
  vaporize: 'Испарение', melt: 'Таяние', bloom: 'Цветение', hyperbloom: 'Вегетация',
  burgeon: 'Возгорание', aggravate: 'Обострение', spread: 'Разрастание', quicken: 'Бодрость',
  overload: 'Перегрузка', superconduct: 'Сверхпроводник', electrocharged: 'Заряжен',
  lunarcharged: 'Лунный заряд', lunarbloom: 'Лунное цветение', swirl: 'Рассеивание',
  crystallize: 'Кристаллизация', freeze: 'Заморозка', shatter: 'Раскол', burning: 'Горение',
};

export function reactionLabel(code: string | undefined, elements: Element[]): string {
  const clean = code?.toLowerCase().replace(/-(pyro|hydro|anemo|electro|dendro|cryo|geo)$/, '');
  if (clean && Object.hasOwn(REACTION_RU, clean)) return REACTION_RU[clean];
  const counts = new Map<Element, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);
  // Map хранит порядок первого появления, поэтому при равенстве остаётся первая стихия
  let best: Element | null = null;
  for (const [element, count] of counts) if (best === null || count > counts.get(best)!) best = element;
  return best === null ? 'Моно' : `Моно ${ELEMENT_RU[best]}`;
}

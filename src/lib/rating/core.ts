export type Role = 'carry' | 'subdps' | 'support' | 'sustain';
export const ROLES: Role[] = ['carry', 'subdps', 'support', 'sustain'];
export type Tier = 'S' | 'A' | 'B' | 'C';
export type Element = 'pyro' | 'hydro' | 'anemo' | 'electro' | 'dendro' | 'cryo' | 'geo';

export type TeamRow = { id: string; m: string[]; dps: number; targets: number; reaction?: string };
export type RoleStat = { value: number; n: number; best: { id: string; team: string[] } };
export type RatingData = {
  _meta: { date: string; source: string; entries: number; baseline: number; teams: number; shares: number };
  characters: Record<string, Partial<Record<'carry' | 'subdps' | 'support', RoleStat>>>;
  teams: TeamRow[];
};
export type RatingManual = {
  characters: Record<string, { patch: string; sources: { title: string; url: string }[]; roles: { role: 'carry' | 'subdps' | 'support'; score: number; note?: string; override?: boolean }[] }>;
  sustain: Record<string, { level: 'plenty' | 'enough' | 'low'; kind: 'heal' | 'shield' | 'both'; note?: string }>;
};
export type SustainLevel = keyof typeof SUSTAIN_SCORE;
export type OverallRow = {
  slug: string; role: Role; value: number | null; score: number; tier: Tier; rank: number;
  kind: 'sim' | 'expert'; source?: { title: string; url: string }; team?: string[]; note?: string;
};

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
      source: { title: 'gcsim', url: simUrl(row.best.id) },
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

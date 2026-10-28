import { fitsAbyssHalf, rankTeams, type Element, type TeamRow } from './core';

export type BossTag = 'nightsoul' | 'lunar' | 'stellar' | 'arkhe' | 'counter' | 'immune' | 'adds' | 'airborne' | 'heal' | 'adaptive' | 'single';
export type Boss = { en: string; weekly?: boolean; tags: BossTag[]; need?: Element[][]; immune?: Element | Element[]; verified: boolean };
export type BossMember = { slug: string; element: Element; weapon: string; carry: boolean; healer: boolean; mechanics: BossTag[] };

export const BOSS_TAGS: Record<BossTag, { label: string; hint: string }> = {
  nightsoul: { label: 'Ночная душа', hint: 'Слабое место открывают атаки в состоянии Ночной души.' },
  lunar: { label: 'Лунные реакции', hint: 'Щиты и механики эффективнее ломают лунные реакции.' },
  stellar: { label: 'Звёздные реакции', hint: 'Механики останавливает реакция Звёздного сияния и другие звёздные реакции.' },
  arkhe: { label: 'Пневма и Усия', hint: 'Ключевая механика ломается атаками Пневмы или Усии.' },
  counter: { label: 'Нужна стихия', hint: 'Щит или ядро ломается определённой стихией.' },
  immune: { label: 'Иммунитет к стихии', hint: 'К своей стихии босс неуязвим: керри этой стихии не подходит.' },
  adds: { label: 'Несколько целей', hint: 'Призывает помощников или ломаемые объекты: ценится урон по площади.' },
  airborne: { label: 'В воздухе и подвижные', hint: 'Часть боя в воздухе или на расстоянии: нужен дальний бой.' },
  heal: { label: 'Нужен хил', hint: 'Постоянный урон по отряду или кокон, из которого выбирает только лечение.' },
  adaptive: { label: 'Адаптивное сопротивление', hint: 'Подстраивает сопротивление под самую частую стихию урона.' },
  single: { label: 'Одиночная цель', hint: 'Без особых требований: решает чистый урон по одной цели.' },
};

export function mechanicTags(talentsText: string): BossTag[] {
  const tags: BossTag[] = [];
  if (/Nightsoul's Blessing/.test(talentsText)) tags.push('nightsoul');
  if (/Moonsign/.test(talentsText)) tags.push('lunar');
  if (/Stellar (Swirl|Conduct|Glimmer)/.test(talentsText)) tags.push('stellar');
  if (/Pneuma|Ousia/.test(talentsText)) tags.push('arkhe');
  return tags;
}

export function bossGroup(boss: Boss): BossTag {
  return boss.tags[0] ?? 'single';
}

export function fitsBoss(boss: Boss, members: BossMember[], targets: number): boolean {
  if (boss.tags.includes('adds') ? targets < 2 : targets !== 1) return false;
  return boss.tags.every((tag) => {
    switch (tag) {
      case 'counter': return fitsAbyssHalf(members.map((member) => member.element), boss.need ?? []);
      case 'immune': return !members.some((member) => member.carry && [boss.immune ?? []].flat().includes(member.element));
      case 'airborne': return members.every((member) => !member.carry || ['bow', 'catalyst'].includes(member.weapon));
      case 'heal': return members.some((member) => member.healer);
      case 'nightsoul':
      case 'lunar':
      case 'stellar':
      case 'arkhe': return members.some((member) => member.mechanics.includes(tag));
      default: return true;
    }
  });
}

export function rankBossTeams(boss: Boss, teams: TeamRow[], membersOf: (t: TeamRow) => BossMember[], limit = 3) {
  return rankTeams(teams, (team) => fitsBoss(boss, membersOf(team), team.targets), limit);
}

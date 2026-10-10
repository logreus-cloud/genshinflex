export const FORUM_CATEGORIES = [
  {
    slug: 'announcements',
    label: 'Объявления',
    description: 'Новости и правила форума от команды сайта',
    icon: '📣',
  },
  {
    slug: 'builds',
    label: 'Билды и команды',
    description: 'Сборки персонажей, артефакты, составы отрядов',
    icon: '⚔️',
  },
  {
    slug: 'endgame',
    label: 'Эндгейм',
    description: 'Бездна, Театр воображариума, Натиск',
    icon: '🔥',
  },
  {
    slug: 'wishes',
    label: 'Баннеры и крутки',
    description: 'Кого крутить, гаранты, удача и неудачи',
    icon: '🌟',
  },
  {
    slug: 'lore',
    label: 'Сюжет и лор',
    description: 'Обсуждение истории и персонажей. Спойлеры — под ||спойлер||',
    icon: '📖',
  },
  {
    slug: 'site',
    label: 'Идеи для сайта',
    description: 'Предложения и пожелания к GenshinFlex',
    icon: '💡',
  },
  {
    slug: 'offtopic',
    label: 'Общение',
    description: 'Всё остальное',
    icon: '💬',
  },
] as const;

export const REACTIONS = [
  { kind: 'like', emoji: '👍' },
  { kind: 'heart', emoji: '❤️' },
  { kind: 'fire', emoji: '🔥' },
  { kind: 'laugh', emoji: '😂' },
  { kind: 'think', emoji: '🤔' },
  { kind: 'sad', emoji: '😢' },
] as const;

export const PAGE_SIZE = 30;

export const threadHref = (base: string, id: number) => `${base}/forum/t/${id}/`;
export const categoryHref = (base: string, slug: string) => `${base}/forum/${slug}/`;

export const SUBJECT_KINDS = ['character', 'rotation', 'build'] as const;
export type Subject = { kind: (typeof SUBJECT_KINDS)[number]; id: string };
const ROTATION_PAGES = ['abyss', 'theater', 'onslaught'];

export function parseSubject(value: string | null): Subject | null {
  const match = /^(character|rotation|build):([a-z0-9][a-z0-9._-]{0,79})$/i.exec(value ?? '');
  return match ? { kind: match[1] as Subject['kind'], id: match[2] } : null;
}

export const subjectParam = (subject: Subject) => `${subject.kind}:${subject.id}`;

export function subjectHref(base: string, subject: Subject): string | null {
  if (subject.kind === 'character' || subject.kind === 'build') return `${base}/characters/${subject.id}/`;
  const mode = subject.id.split('-')[0];
  return ROTATION_PAGES.includes(mode) ? `${base}/${mode}/` : null;
}

export const newSubjectThreadHref = (base: string, subject: Subject, label: string) =>
  `${base}/forum/new/?${new URLSearchParams({
    c: subject.kind === 'rotation' ? 'endgame' : 'builds',
    subject: subjectParam(subject),
    label,
  })}`;

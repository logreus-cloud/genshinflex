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

import type { Lang } from '../i18n';
import type { icons } from './nav-icons';

export const NAV_GROUPS = [null, 'База', 'Эндгейм', 'Таймлайн', 'Гайды', 'Сайт', 'Инструменты', 'В разработке'] as const;
export const FOOTER_COLUMNS = ['База', 'Эндгейм', 'Инструменты', 'Сайт'] as const;

type Social = { telegram?: string; discord?: string };
type Section = {
  id: string; href: string | ((lang: Lang, social: Social) => string | undefined); label: string; icon: keyof typeof icons;
  navGroup?: (typeof NAV_GROUPS)[number]; footerColumn?: (typeof FOOTER_COLUMNS)[number]; footerOrder?: number;
  short?: string; soon?: boolean; footerOnly?: boolean; external?: boolean;
};
// shortByLang — если краткое название нельзя взять из словаря: «Натиск» по-русски совпадает с полным, а в en/es — нет
type ModeSection = Section & { href: string; shortByLang?: Record<Lang, string> };

const MAP_LANG = { ru: 'ru-ru', en: 'en-us', es: 'es-es' } as const;

export const MODE_SECTIONS: Record<string, ModeSection> = {
  abyss: { id: 'abyss', href: '/abyss', label: 'Витая бездна', short: 'Бездна', icon: 'spiral', navGroup: 'Эндгейм', footerColumn: 'Эндгейм', footerOrder: 2 },
  theater: { id: 'theater', href: '/theater', label: 'Театр воображариума', short: 'Театр', icon: 'mask', navGroup: 'Эндгейм', footerColumn: 'Эндгейм', footerOrder: 3 },
  onslaught: { id: 'onslaught', href: '/onslaught', label: 'Натиск', shortByLang: { ru: 'Натиск', en: 'Onslaught', es: 'Embestida' }, icon: 'flame', navGroup: 'Эндгейм', footerColumn: 'Эндгейм', footerOrder: 4 },
};

export const ROTATION_SECTION = { id: 'rotation', href: '/rotation', label: 'Все режимы', icon: 'moon', navGroup: 'Эндгейм' } as const;

export const SECTIONS: Section[] = [
  { id: 'home', href: '/', label: 'Главная', icon: 'home', navGroup: null },
  { id: 'characters', href: '/characters', label: 'Персонажи', icon: 'user', navGroup: 'База', footerColumn: 'База', footerOrder: 1 },
  { id: 'weapons', href: '/weapons', label: 'Оружие', icon: 'sword', navGroup: 'База', footerColumn: 'База', footerOrder: 2 },
  { id: 'artifacts', href: '/artifacts', label: 'Артефакты', icon: 'flower', navGroup: 'База', footerColumn: 'База', footerOrder: 3 },
  ROTATION_SECTION,
  MODE_SECTIONS.abyss,
  MODE_SECTIONS.theater,
  MODE_SECTIONS.onslaught,
  { id: 'calendar', href: '/calendar', label: 'Календарь', icon: 'calendar', navGroup: 'Таймлайн', footerColumn: 'Эндгейм', footerOrder: 1 },
  { id: 'banners', href: '/banners', label: 'Баннеры', icon: 'moon', navGroup: 'Таймлайн', footerColumn: 'Эндгейм', footerOrder: 5 },
  { id: 'guides', href: '/guides', label: 'Руководства', icon: 'book', navGroup: 'Гайды', footerColumn: 'База', footerOrder: 4 },
  { id: 'profile', href: '/profile', label: 'Мой профиль', icon: 'user', navGroup: 'Сайт' },
  { id: 'news', href: '/news', label: 'Новости сайта', icon: 'book', navGroup: 'Сайт', footerColumn: 'Сайт', footerOrder: 1 },
  { id: 'simulator', href: '/tools/simulator', label: 'Симулятор команды', icon: 'chart', navGroup: 'Инструменты', footerColumn: 'Инструменты', footerOrder: 1 },
  { id: 'team-check', href: '/tools/team-check', label: 'Проверка команды', icon: 'check', navGroup: 'Инструменты', footerColumn: 'Инструменты', footerOrder: 2 },
  { id: 'wishes', href: '/tools/wishes', label: 'Трекер круток', icon: 'star', navGroup: 'Инструменты', footerColumn: 'Инструменты', footerOrder: 3 },
  { id: 'rotation-builder', href: '/tools/rotation-builder', label: 'Конструктор ротаций', icon: 'tool', navGroup: 'Инструменты', footerColumn: 'Инструменты', footerOrder: 4 },
  { id: 'calculator', href: '/tools/calculator', label: 'Калькулятор прокачки', icon: 'calc', navGroup: 'Инструменты', footerColumn: 'Инструменты', footerOrder: 5 },
  { id: 'rating', href: '/rating', label: 'Рейтинг', icon: 'chart', navGroup: 'В разработке', footerColumn: 'Эндгейм', footerOrder: 7, soon: true },
  { id: 'banner-history', href: '/banners/#history', label: 'История баннеров', icon: 'moon', footerColumn: 'Эндгейм', footerOrder: 6, footerOnly: true },
  { id: 'map', href: (lang: Lang) => `https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=${MAP_LANG[lang]}`, label: 'Карта Тейвата', icon: 'home', footerColumn: 'Инструменты', footerOrder: 6, footerOnly: true, external: true },
  { id: 'telegram', href: (_lang: Lang, social: Social) => social.telegram, label: 'Telegram-канал', icon: 'book', footerColumn: 'Сайт', footerOrder: 2, footerOnly: true, external: true },
  { id: 'discord', href: (_lang: Lang, social: Social) => social.discord, label: 'Discord-сервер', icon: 'book', footerColumn: 'Сайт', footerOrder: 3, footerOnly: true, external: true },
  { id: 'about', href: '/about/', label: 'О сайте', icon: 'book', footerColumn: 'Сайт', footerOrder: 4, footerOnly: true },
  { id: 'feedback', href: '/feedback/', label: 'Обратная связь', icon: 'book', footerColumn: 'Сайт', footerOrder: 5, footerOnly: true },
  { id: 'privacy', href: '/privacy/', label: 'Политика конфиденциальности', icon: 'book', footerColumn: 'Сайт', footerOrder: 6, footerOnly: true },
  { id: 'sitemap', href: '/sitemap.xml', label: 'Sitemap', icon: 'book', footerColumn: 'Сайт', footerOrder: 7, footerOnly: true },
];

export const sectionHref = (section: Section, lang: Lang, social: Social) =>
  typeof section.href === 'function' ? section.href(lang, social) : section.href;

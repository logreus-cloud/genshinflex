import { pageLang } from '../i18n/client';
// Общие клиентские утилиты: безопасное хранилище, недавние/избранное, таймеры по времени сервера.

export type Entry = { href: string; name: string; icon?: string | null; kind: string };

export const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим — просто не запоминаем */ }
  },
};

// Недавние и избранное — отдельно для каждого языка: в записи хранятся подписи и ссылки на языке страницы
const langKey = (k: string) => (pageLang() === 'ru' ? k : `${k}:${pageLang()}`);
export const recent = {
  list: () => store.get<Entry[]>(langKey('gf:recent'), []),
  push(e: Entry) {
    store.set(langKey('gf:recent'), [e, ...recent.list().filter((x) => x.href !== e.href)].slice(0, 12));
  },
};

export const favorites = {
  list: () => store.get<Entry[]>(langKey('gf:favs'), []),
  has: (href: string) => favorites.list().some((x) => x.href === href),
  toggle(e: Entry) {
    const list = favorites.list();
    const next = list.some((x) => x.href === e.href) ? list.filter((x) => x.href !== e.href) : [e, ...list];
    store.set(langKey('gf:favs'), next);
    return next.some((x) => x.href === e.href);
  },
};

// Время в игре считается по часовому поясу сервера: Азия UTC+8, Европа UTC+1, Америка UTC−5
export const REGIONS = { asia: { offset: 8 }, eu: { offset: 1 }, na: { offset: -5 } } as const;
export type Region = keyof typeof REGIONS;
export const region = {
  get: (): Region => store.get<Region>('gf:region', 'eu'),
  set: (r: Region) => { store.set('gf:region', r); document.dispatchEvent(new CustomEvent('gf:region', { detail: r })); },
};

// «2026-10-16T04:00» по времени сервера → момент в UTC
export function serverMoment(local: string, r: Region = region.get()) {
  const [d, t = '04:00'] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, day, h - REGIONS[r].offset, min);
}

const plural = (n: number, [one, few, many]: [string, string, string]) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};
export function humanLeft(ms: number) {
  if (ms <= 0) return null;
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  const lang = pageLang();
  const dayWord = lang === 'ru' ? plural(d, ['день', 'дня', 'дней']) : lang === 'es' ? (d === 1 ? 'día' : 'días') : (d === 1 ? 'day' : 'days');
  const [hh, mm] = lang === 'ru' ? ['ч', 'мин'] : ['h', 'min'];
  if (d > 0) return `${d} ${dayWord} ${h} ${hh}`;
  if (h > 0) return `${h} ${hh} ${m} ${mm}`;
  return `${m} ${mm}`;
}

// <span data-until="2026-10-16T04:00" data-done="Обновилось">…</span> — обратный отсчёт до события сервера
function tick() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-until]')) {
    const left = humanLeft(serverMoment(el.dataset.until!) - Date.now());
    el.textContent = left ? `${el.dataset.prefix ?? ''}${left}` : el.dataset.done ?? '—';
  }
}
tick();
setInterval(tick, 30_000);
document.addEventListener('gf:region', tick);

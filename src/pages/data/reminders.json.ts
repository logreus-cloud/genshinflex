import { calendarItems } from '../../lib/calendar';
import type { CalItem } from '../../lib/calendar';

type ReminderType = 'banner-start' | 'banner-end' | 'event-end' | 'abyss' | 'theater' | 'onslaught' | 'version' | 'livestream';
type Reminder = { id: string; type: ReminderType; title: string; at: string; url: string | null; image: string | null; estimated: boolean };
const SITE = 'https://genshinflex.com';

// Календарь хранит время сервера Европа (UTC+1), без перехода на летнее время.
const serverTime = (local: string) => {
  const [date, time] = local.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour - 1, minute);
};
const absolute = (path?: string | null) => path ? new URL(path, SITE).toString() : null;

export const prerender = true;

export async function GET() {
  const items = await calendarItems('ru');
  const now = Date.now();
  const min = now - 86_400_000;
  const max = now + 60 * 86_400_000;
  const events: Reminder[] = [];

  for (const item of items) {
    const image = absolute(item.image || item.icons?.[0]?.src);
    const url = absolute(item.href);
    const add = (type: ReminderType, local: string, suffix: 'start' | 'end') => {
      const at = serverTime(local);
      if (at < min || at > max) return;
      events.push({
        id: `${item.id}:${suffix}`,
        type,
        title: item.title,
        at: new Date(at).toISOString(),
        url,
        image,
        estimated: Boolean(item.estimated),
      });
    };

    switch (item.kind) {
      case 'char-banner':
      case 'weapon-banner':
        add('banner-start', item.start, 'start');
        if (item.end) add('banner-end', item.end, 'end');
        break;
      case 'event':
        if (item.end) add('event-end', item.end, 'end');
        break;
      default:
        add(item.kind as Exclude<CalItem['kind'], 'char-banner' | 'weapon-banner' | 'event'>, item.start, 'start');
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return new Response(JSON.stringify({ generated: new Date(now).toISOString(), server: 'eu', events }), { headers: { 'Content-Type': 'application/json' } });
}

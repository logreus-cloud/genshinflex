export type ReminderType = 'banner-start' | 'banner-end' | 'event-end' | 'abyss' | 'theater' | 'onslaught' | 'version' | 'livestream';
export type Reminder = { id: string; type: ReminderType; title: string; at: string; url: string | null; image: string | null; estimated: boolean };
export type Picked = { event: Reminder; when: 'day' | 'now'; text: string };
type Env = { SITE: string; DISCORD_WEBHOOK_REMINDERS?: string; DISCORD_REMINDERS_ROLE_ID?: string };
interface ScheduledController { scheduledTime: number }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

const HOUR = 3_600_000;
const DAY: Partial<Record<ReminderType, string>> = {
  abyss: '⏳ Бездна обновится завтра',
  theater: '⏳ Театр обновится завтра',
  onslaught: '⏳ Натиск обновится завтра',
  'banner-end': '⏳ Баннер заканчивается завтра',
  'banner-start': '✨ Новый баннер завтра',
  'event-end': '⏳ Ивент заканчивается завтра',
  version: '📦 Обновление завтра',
  livestream: '📺 Стрим завтра',
};
const NOW: Partial<Record<ReminderType, string>> = {
  'banner-start': '✨ Новый баннер уже доступен',
  abyss: '✨ Бездна обновилась',
  livestream: '📺 Стрим уже начался',
};
const COLORS: Record<ReminderType, number> = {
  abyss: 0x9B59B6,
  theater: 0x3498DB,
  onslaught: 0xE05252,
  'banner-start': 0xE3B04B,
  'banner-end': 0xE3B04B,
  'event-end': 0x55A86B,
  version: 0xE3B04B,
  livestream: 0x5865F2,
};
const clip = (value: string, limit: number) => {
  const chars = Array.from(value);
  return chars.length <= limit ? value : `${chars.slice(0, limit - 1).join('')}…`;
};

export function pick(events: Reminder[], hourMs: number): Picked[] {
  const result: Picked[] = [];
  for (const event of events) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    const when = at >= hourMs + 24 * HOUR && at < hourMs + 25 * HOUR ? 'day'
      : at >= hourMs && at < hourMs + HOUR ? 'now' : null;
    if (!when) continue;
    const text = (when === 'day' ? DAY : NOW)[event.type];
    if (text) result.push({ event, when, text });
  }
  return result;
}

const serverDate = (at: string) => {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZone: 'UTC',
  }).formatToParts(new Date(Date.parse(at) + HOUR));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('weekday')}, ${value('day')} ${value('month')}, ${value('hour')}:${value('minute')} по серверу Европа · <t:${Math.floor(Date.parse(at) / 1000)}:R>`;
};

export function buildMessage(items: Picked[], role?: string) {
  if (!items.length) return null;
  return {
    username: 'GenshinFlex',
    content: role ? `<@&${role}> Напоминания` : 'Напоминания',
    allowed_mentions: role ? { roles: [role] } : { parse: [] },
    embeds: items.slice(0, 10).map(({ event, text }) => ({
      title: event.estimated ? `${clip(`${text} — ${event.title}`, 256 - 12)} (ожидается)` : clip(`${text} — ${event.title}`, 256),
      description: serverDate(event.at),
      color: COLORS[event.type],
      ...(event.url ? { url: event.url } : {}),
      ...(event.image ? { thumbnail: { url: event.image } } : {}),
    })),
  };
}

async function request(url: string, label: string, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function upcoming(env: Env, hour: number) {
  const data = JSON.parse(await request(new URL('/data/reminders.json', env.SITE).toString(), 'reminders.json')) as { events: Reminder[] };
  return pick(data.events, hour);
}

export default {
  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    try {
      const hour = Math.floor(event.scheduledTime / HOUR) * HOUR;
      const items = await upcoming(env, hour);
      if (!items.length) return;
      if (!env.DISCORD_WEBHOOK_REMINDERS) throw new Error('Не задан DISCORD_WEBHOOK_REMINDERS');
      for (let i = 0; i < items.length; i += 10) {
        // Роль пингуем только в первом сообщении
        const body = buildMessage(items.slice(i, i + 10), i === 0 ? env.DISCORD_REMINDERS_ROLE_ID : undefined);
        await request(env.DISCORD_WEBHOOK_REMINDERS, 'Discord webhook', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      }
    } catch (error) {
      console.error('Не удалось отправить напоминания в Discord:', error);
    }
  },
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (req.method !== 'GET') return new Response('Метод не поддерживается', { status: 405 });
    if (url.pathname === '/') return new Response('ok');
    if (url.pathname !== '/preview') return new Response('Не найдено', { status: 404 });
    const hours = url.searchParams.get('hours') ?? '0';
    if (!/^\d+$/.test(hours) || Number(hours) > 720) return new Response('hours: целое число от 0 до 720', { status: 400 });
    try {
      const hour = Math.floor((Date.now() + Number(hours) * HOUR) / HOUR) * HOUR;
      const events = await upcoming(env, hour);
      return Response.json({ hour: new Date(hour).toISOString(), events, message: buildMessage(events, env.DISCORD_REMINDERS_ROLE_ID) });
    } catch (error) {
      console.error('Не удалось получить напоминания:', error);
      return Response.json({ error: 'Не удалось получить напоминания' }, { status: 502 });
    }
  },
};

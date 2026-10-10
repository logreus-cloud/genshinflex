import type { SupabaseClient } from '@supabase/supabase-js';

export type TelegramNotification = {
  id: number;
  telegram_id: number;
  kind: string;
  actor: { name?: string; nickname?: string; public?: boolean } | null;
  thread_id: number | null;
  thread_title: string | null;
  post_id: number | null;
  snippet: string | null;
};

const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeHtml = (value: string) => value.replace(/[&<>]/g, (char) => escapes[char]);

export function telegramMessage(item: TelegramNotification, site = 'https://genshinflex.com'): string {
  const name = item.actor?.name ?? 'Удалённый пользователь';
  const topic = item.thread_title ? ` в теме «${item.thread_title}»` : '';
  let heading: string;
  switch (item.kind) {
    case 'reply':
      heading = `Ответ от ${name}${topic}`;
      break;
    case 'mention':
      heading = `Упоминание от ${name}${topic}`;
      break;
    case 'follow':
      heading = `Новый подписчик: ${name}`;
      break;
    case 'friend_request':
      heading = `Заявка в друзья от ${name}`;
      break;
    case 'friend_accept':
      heading = `${name} теперь у вас в друзьях`;
      break;
    case 'message':
      heading = `Сообщение от ${name}`;
      break;
    default:
      heading = `Уведомление от ${name}`;
  }
  let href = item.kind === 'message' ? site : `${site}/notifications/`;
  if ((item.kind === 'reply' || item.kind === 'mention') && item.thread_id !== null)
    href = `${site}/forum/t/${item.thread_id}/${item.post_id !== null ? `#p${item.post_id}` : ''}`;
  else if (item.kind === 'friend_request')
    href = `${site}/friends/`;
  else if ((item.kind === 'follow' || item.kind === 'friend_accept') && item.actor?.public && item.actor.nickname)
    href = `${site}/u/${encodeURIComponent(item.actor.nickname)}/`;
  const snippet = item.snippet?.replace(/\s+/g, ' ').trim();
  const short = snippet ? Array.from(snippet).slice(0, 160).join('') : '';
  return [
    escapeHtml(heading),
    ...(short ? [escapeHtml(short)] : []),
    `<a href="${escapeHtml(href)}">Открыть на GenshinFlex</a>`,
  ].join('\n\n');
}

export async function deliverTelegramNotifications(
  client: Pick<SupabaseClient, 'rpc'>,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ claimed: number; sent: number }> {
  if (!token) return { claimed: 0, sent: 0 };
  const { data, error } = await client.rpc('telegram_notifications_claim', { p_limit: 50 });
  if (error) throw error;
  const items = (data ?? []) as TelegramNotification[];
  let sent = 0;
  for (const item of items) {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: item.telegram_id,
          text: telegramMessage(item),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (response.ok) sent++;
    } catch {}
  }
  return { claimed: items.length, sent };
}

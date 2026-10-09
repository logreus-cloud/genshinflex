import { threadHref } from '../../lib/forum';
import { t } from '../search';
import type { Author } from '../forum/api';

export type NotificationKind = 'reply' | 'mention' | 'friend_request' | 'friend_accept' | 'follow' | 'message';

export type NotificationItem = {
  id: number;
  kind: NotificationKind;
  created_at: string;
  read_at: string | null;
  actor: Author;
  thread_id: number | null;
  thread_title: string | null;
  post_id: number | null;
  snippet: string | null;
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { getSupabase } = await import('../auth');
  const { data, error } = await getSupabase().rpc(name, args as never);
  if (error) throw error;
  return data as T;
}

export const notificationsList = (beforeId: number | null = null, limit = 30) =>
  rpc<NotificationItem[]>('notifications_list', { p_before_id: beforeId, p_limit: limit });
export const unreadCount = () => rpc<number>('notifications_unread_count');
export const markRead = (ids: number[] | null) => rpc<number>('notifications_mark_read', { p_ids: ids });

export function notificationText(item: NotificationItem): string {
  const name = item.actor?.name ?? t('Удалённый пользователь');
  switch (item.kind) {
    case 'reply':
      return item.thread_title
        ? t('Ответ от {name} в теме «{title}»', { name, title: item.thread_title })
        : t('Ответ от {name}', { name });
    case 'mention':
      return item.thread_title
        ? t('Упоминание от {name} в теме «{title}»', { name, title: item.thread_title })
        : t('Упоминание от {name}', { name });
    case 'follow': return t('Новый подписчик: {name}', { name });
    case 'friend_request': return t('Заявка в друзья от {name}', { name });
    case 'friend_accept': return t('{name} теперь у вас в друзьях', { name });
    case 'message': return t('Сообщение от {name}', { name });
  }
}

export function notificationHref(item: NotificationItem, base: string): string | null {
  if (item.kind === 'reply' || item.kind === 'mention')
    return item.thread_id ? `${threadHref(base, item.thread_id)}${item.post_id ? `#p${item.post_id}` : ''}` : null;
  if (item.kind === 'friend_request') return `${base}/friends/`;
  if (item.kind === 'follow' || item.kind === 'friend_accept')
    return item.actor?.public && item.actor.nickname ? `${base}/u/${encodeURIComponent(item.actor.nickname)}/` : null;
  return null;
}

import { t } from '../search';
import type { Author } from '../forum/api';

export type SocialRelation = {
  following: boolean;
  followed_by: boolean;
  friend: 'none' | 'outgoing' | 'incoming' | 'friends' | 'declined';
  blocked: boolean;
  can_request: boolean;
};

export type SocialCounts = { followers: number; following: number; friends: number; lists_hidden: boolean };
export type SocialListKind = 'followers' | 'following' | 'friends';
export type SocialListRow = { user_id: string; author: Author; since: string };
export type SocialRequest = { user_id: string; author: Author; created_at: string };
export type SocialBlockedRow = { user_id: string; author: Author; created_at: string };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { getSupabase } = await import('../auth');
  const { data, error } = await getSupabase().rpc(name, args as never);
  if (error) throw error;
  return data as T;
}

const safeCount = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const socialRelation = (user: string) => rpc<SocialRelation>('social_relation', { p_user: user });
export const socialCounts = async (user: string): Promise<SocialCounts | null> => {
  const row = (await rpc<{ followers: unknown; following: unknown; friends: unknown; lists_hidden: unknown }[]>('social_counts', { p_user: user }))[0];
  return row ? { followers: safeCount(row.followers), following: safeCount(row.following), friends: safeCount(row.friends), lists_hidden: row.lists_hidden === true } : null;
};
export const follow = (user: string) => rpc<void>('social_follow', { p_user: user });
export const unfollow = (user: string) => rpc<void>('social_unfollow', { p_user: user });
export const friendRequest = (user: string) => rpc<'outgoing' | 'friends'>('social_friend_request', { p_user: user });
export const friendRespond = (user: string, accept: boolean) => rpc<void>('social_friend_respond', { p_user: user, p_accept: accept });
export const friendRemove = (user: string) => rpc<void>('social_friend_remove', { p_user: user });
export const block = (user: string) => rpc<void>('social_block', { p_user: user });
export const unblock = (user: string) => rpc<void>('social_unblock', { p_user: user });
export const socialList = (user: string, kind: SocialListKind, limit = 30, offset = 0) =>
  rpc<SocialListRow[]>('social_list', { p_user: user, p_kind: kind, p_limit: limit, p_offset: offset });
export const socialRequests = (direction: 'incoming' | 'outgoing', limit = 30, offset = 0) =>
  rpc<SocialRequest[]>('social_requests', { p_direction: direction, p_limit: limit, p_offset: offset });
export const socialBlocked = (limit = 30, offset = 0) =>
  rpc<SocialBlockedRow[]>('social_blocked', { p_limit: limit, p_offset: offset });

export async function socialBlockedIds(): Promise<Set<string>> {
  try {
    const ids = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const rows = await socialBlocked(50, page * 50);
      for (const row of rows) ids.add(row.user_id);
      if (rows.length < 50) break;
    }
    return ids;
  } catch {
    return new Set<string>();
  }
}

export function socialErrorText(error: unknown) {
  const code = /social:([a-z_]+)/.exec((error as { message?: string })?.message ?? '')?.[1];
  if (code === 'rate_limited') return t('Слишком часто — подождите немного');
  if (code === 'cooldown') return t('Повторить заявку можно через 3 дня после отказа');
  if (code === 'requests_closed') return t('Пользователь не принимает заявки в друзья');
  if (code === 'unavailable') return t('Действие недоступно');
  if (code === 'not_found') return t('Профиль не найден или скрыт');
  if (code === 'auth_required') return t('Войдите в аккаунт');
  return t('Не получилось. Попробуйте ещё раз');
}

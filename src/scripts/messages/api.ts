import { t } from '../search';
import type { Author } from '../forum/api';

export type Conversation = {
  id: number;
  other: Author;
  last_message_at: string;
  last_body: string | null;
  last_sender_is_me: boolean;
  unread: number;
  can_send: boolean;
};

export type Message = {
  id: number;
  sender_id: string;
  body: string | null;
  created_at: string;
  deleted: boolean;
};

export type DmReportReason = 'spam' | 'abuse' | 'other';
export type DmReportStatus = 'open' | 'resolved' | 'dismissed';

export type DmReport = {
  id: number;
  message_id: number;
  reason: DmReportReason;
  comment: string | null;
  status: DmReportStatus;
  created_at: string;
  reporter: Author;
  author: Author;
  body: string;
  message_deleted: boolean;
  context: {
    id: number;
    sender_id: string;
    sender: Author;
    body: string | null;
    created_at: string;
    reported: boolean;
  }[];
};

export type MessagePrivacy = 'everyone' | 'followers' | 'friends';

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { getSupabase } = await import('../auth');
  const { data, error } = await getSupabase().rpc(name, args as never);
  if (error) throw error;
  return data as T;
}

export const dmConversations = (before: { at: string; id: number } | null, limit = 20) =>
  rpc<Conversation[]>('dm_conversations', { p_before: before?.at ?? null, p_before_id: before?.id ?? null, p_limit: limit });
export const dmConversation = async (id: number): Promise<Conversation | null> =>
  (await rpc<Conversation[]>('dm_conversation', { p_conversation: id }))[0] ?? null;
export const dmOpen = (user: string) => rpc<number>('dm_open', { p_user: user });
export const dmSend = (conversation: number, body: string) =>
  rpc<{ id: number; created_at: string }[]>('dm_send', { p_conversation: conversation, p_body: body });
export const dmMessages = (conversation: number, beforeId: number | null = null, limit = 20) =>
  rpc<Message[]>('dm_messages', { p_conversation: conversation, p_before_id: beforeId, p_limit: limit });
export const dmMarkRead = (conversation: number) => rpc<number>('dm_mark_read', { p_conversation: conversation });
export const dmDeleteMessage = (message: number) => rpc<boolean>('dm_delete_message', { p_message: message });
export const dmReport = (message: number, reason: DmReportReason, comment: string | null = null) =>
  rpc<void>('dm_report', { p_message: message, p_reason: reason, p_comment: comment });
export const dmReportsQueue = (status: DmReportStatus | null = 'open', limit = 30, offset = 0) =>
  rpc<DmReport[]>('dm_reports_queue', { p_status: status, p_limit: limit, p_offset: offset });
export const dmResolveReport = (report: number, status: 'resolved' | 'dismissed') =>
  rpc<void>('dm_resolve_report', { p_report: report, p_status: status });
export const dmModerateDelete = (message: number) => rpc<void>('dm_moderate_delete', { p_message: message });
export const dmUnreadCount = () => rpc<number>('dm_unread_count');
export const dmCanMessage = (user: string) => rpc<boolean>('dm_can_message', { p_user: user });
export const setMessagePrivacy = (value: MessagePrivacy) => rpc<unknown>('set_message_privacy', { p_value: value });

export function messageError(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  if (typeof message !== 'string') return t('Не удалось отправить');
  if (message.includes('dm:unavailable')) return t('Этому пользователю нельзя написать');
  if (message.includes('dm:banned')) return t('Вам запрещено писать сообщения: действует блокировка');
  if (message.includes('social:rate_limited')) return t('Слишком много сообщений, попробуйте позже');
  if (message.includes('dm:rate_limited')) return t('Слишком много жалоб, попробуйте позже');
  if (message.includes('dm:invalid')) return t('Сообщение пустое или длиннее 2000 символов');
  return t('Не удалось отправить');
}

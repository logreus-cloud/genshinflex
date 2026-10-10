import { t } from '../search';

export type Author = {
  id: string;
  nickname: string;
  name: string;
  public: boolean;
  custom: unknown;
  moderator: boolean;
  guild?: { slug: string; tag: string; name: string } | null;
} | null;

export type ForumThread = {
  id: number;
  category: string;
  title: string;
  lang: string;
  pinned: boolean;
  locked: boolean;
  deleted: boolean;
  subject_kind: SubjectKind | null;
  subject_id: string | null;
  post_count: number;
  last_post_at: string;
  author: Author;
  first_post_id?: number;
};

export type SubjectKind = 'character' | 'rotation' | 'build';

export type ForumPost = {
  id: number;
  thread_id: number;
  reply_to: number | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  body: string | null;
  delete_reason: string | null;
  author: Author;
  reactions: Record<string, number>;
  my_reactions: string[];
  mine: boolean;
};

export type ForumMe = {
  moderator: boolean;
  banned_until: string | null;
  banned: boolean;
  ban_reason: string | null;
  links_allowed: boolean;
};

export type ForumReport = {
  id: number;
  post_id: number;
  thread_id: number;
  thread_title: string;
  post_body: string;
  post_deleted: boolean;
  reason: string;
  comment: string | null;
  status: string;
  author: Author;
  reporter: Author;
  reports_on_post: number;
};

export type CategoryStat = {
  slug: string;
  thread_count: number;
  post_count: number;
  last_thread_id: number | null;
  last_thread_title: string | null;
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { getSupabase } = await import('../auth');
  const { data, error } = await getSupabase().rpc(name, args as never);
  if (error) throw error;
  return data as T;
}

export const forumCategoryStats = () => rpc<CategoryStat[]>('forum_category_stats');
export const forumThreads = (category: string | null = null, lang: string | null = null, limit = 30, offset = 0) =>
  rpc<ForumThread[]>('forum_threads', { p_category: category, p_lang: lang, p_limit: limit, p_offset: offset });
export const forumThread = async (id: number) =>
  (await rpc<ForumThread[]>('forum_thread', { p_id: id }))[0] ?? null;
export const forumPosts = (thread: number, limit = 30, offset = 0) =>
  rpc<ForumPost[]>('forum_posts', { p_thread: thread, p_limit: limit, p_offset: offset });
export const forumUserPosts = (nickname: string, limit = 20, offset = 0) =>
  rpc<{ id: number; thread_id: number; thread_title: string; body: string; created_at: string }[]>(
    'forum_user_posts',
    { p_nickname: nickname, p_limit: limit, p_offset: offset },
  );

export async function forumMe(): Promise<ForumMe | null> {
  const { getSupabase } = await import('../auth');
  const { data } = await getSupabase().auth.getSession();
  return data.session ? (await rpc<ForumMe[]>('forum_me'))[0] ?? null : null;
}

export const forumReportsQueue = (status = 'open', limit = 30, offset = 0) =>
  rpc<ForumReport[]>('forum_reports_queue', { p_status: status, p_limit: limit, p_offset: offset });
export type ForumScore = { points: number; reactions: number; replies: number; views: number };
export type LeaderboardRow = ForumScore & { author: Author };
export const forumView = (thread: number) => rpc<void>('forum_view', { p_thread: thread });
export const forumLeaderboard = (limit = 50, offset = 0) =>
  rpc<LeaderboardRow[]>('forum_leaderboard', { p_limit: limit, p_offset: offset });
export const forumUserScore = async (user: string) =>
  (await rpc<(ForumScore & { place: number | null })[]>('forum_user_score', { p_user: user }))[0] ?? null;
export const forumSubjectThreads = (kind: SubjectKind, id: string, limit = 5) =>
  rpc<ForumThread[]>('forum_subject_threads', { p_kind: kind, p_id: id, p_limit: limit });
export const createThread = (
  category: string, title: string, body: string, lang: string,
  subject: { kind: SubjectKind; id: string } | null = null,
) =>
  rpc<number>('forum_create_thread', {
    p_category: category, p_title: title, p_body: body, p_lang: lang,
    p_subject_kind: subject?.kind ?? null, p_subject_id: subject?.id ?? null,
  });
export const createPost = (thread: number, body: string, replyTo: number | null) =>
  rpc<number>('forum_create_post', { p_thread: thread, p_body: body, p_reply_to: replyTo });
export const editPost = (post: number, body: string) =>
  rpc<void>('forum_edit_post', { p_post: post, p_body: body });
export const editThread = (thread: number, title: string) =>
  rpc<void>('forum_edit_thread', { p_thread: thread, p_title: title });
export const deletePost = (post: number, reason: string | null = null) =>
  rpc<void>('forum_delete_post', { p_post: post, p_reason: reason });
export const restorePost = (post: number) =>
  rpc<void>('forum_restore_post', { p_post: post });
export const moderateThread = (
  thread: number,
  changes: { p_pinned?: boolean; p_locked?: boolean; p_deleted?: boolean; p_category?: string },
) => rpc<void>('forum_moderate_thread', { p_thread: thread, ...changes });
export const setReaction = (post: number, kind: string, on: boolean) =>
  rpc<void>('forum_set_reaction', { p_post: post, p_kind: kind, p_on: on });
export const report = (post: number, reason: string, comment: string) =>
  rpc<void>('forum_report', { p_post: post, p_reason: reason, p_comment: comment });
export const resolveReport = (id: number, status: string) =>
  rpc<void>('forum_resolve_report', { p_report: id, p_status: status });
export const ban = (user: string, until: string | null, reason: string) =>
  rpc<void>('forum_ban', { p_user: user, p_until: until, p_reason: reason });
export const unban = (user: string) => rpc<void>('forum_unban', { p_user: user });

export function forumErrorText(error: unknown, until?: string | null) {
  const code = /forum:([a-z_]+)/.exec((error as { message?: string })?.message ?? '')?.[1];
  if (code === 'auth_required') return t('Войдите, чтобы писать на форуме');
  if (code === 'banned') {
    return until
      ? t('Вы заблокированы на форуме до {date}', { date: new Date(until).toLocaleString() })
      : t('Вы заблокированы на форуме');
  }
  if (code === 'rate_limited') return t('Слишком часто — подождите немного');
  if (code === 'links_not_allowed') return t('Новым аккаунтам ссылки можно публиковать через 3 дня после регистрации');
  if (code === 'locked') return t('Тема закрыта');
  if (code === 'not_found') return t('Не найдено');
  if (code === 'forbidden') return t('Недостаточно прав');
  if (code === 'invalid') return t('Проверьте заполнение');
  return t('Не получилось. Попробуйте ещё раз');
}

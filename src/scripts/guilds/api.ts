import { t } from '../search';
import type { Author } from '../forum/api';

export type Guild = {
  slug: string;
  name: string;
  tag: string;
  description: string | null;
  members: number;
  created_at: string;
};
export type GuildDetails = Guild & { owner: Author; is_member: boolean; my_guild: string | null };
export type GuildMember = { author: Author; joined_at: string; is_owner: boolean };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { getSupabase } = await import('../auth');
  const { data, error } = await getSupabase().rpc(name, args as never);
  if (error) throw error;
  return data as T;
}

export const guildList = (limit = 30, offset = 0) => rpc<Guild[]>('guild_list', { p_limit: limit, p_offset: offset });
export const guildGet = async (slug: string) => (await rpc<GuildDetails[]>('guild_get', { p_slug: slug }))[0] ?? null;
export const guildMembers = (slug: string, limit = 50, offset = 0) =>
  rpc<GuildMember[]>('guild_member_list', { p_slug: slug, p_limit: limit, p_offset: offset });
export const guildOf = async (user: string) =>
  (await rpc<{ slug: string; tag: string; name: string }[]>('guild_of', { p_user: user }))[0] ?? null;
export const guildMine = () => rpc<string | null>('guild_mine');
export const guildCreate = (slug: string, name: string, tag: string, description: string) =>
  rpc<string>('guild_create', { p_slug: slug, p_name: name, p_tag: tag, p_description: description || null });
export const guildJoin = (slug: string) => rpc<void>('guild_join', { p_slug: slug });
export const guildLeave = () => rpc<void>('guild_leave');
export const guildModerateDelete = (slug: string) => rpc<void>('guild_moderate_delete', { p_slug: slug });

export function guildError(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  if (typeof message !== 'string') return t('Не удалось выполнить действие');
  if (message.includes('guild:already_member')) return t('Вы уже состоите в гильдии');
  if (message.includes('guild:taken')) return t('Адрес, название или тег уже заняты');
  if (message.includes('guild:invalid')) return t('Проверьте заполнение');
  if (message.includes('guild:not_found')) return t('Гильдия не найдена');
  if (message.includes('guild:auth_required')) return t('Войдите в аккаунт');
  return t('Не удалось выполнить действие');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { purgeAccount } from './account.ts';
import type { AdminClient } from './account.ts';

export class AccountError extends Error {
  readonly status: 400 | 403 | 404;
  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.status = status;
  }
}

export type AccountClient = {
  rpc: SupabaseClient['rpc'];
  from: SupabaseClient['from'];
  storage: AdminClient['storage'];
  auth: { admin: Pick<SupabaseClient['auth']['admin'], 'getUserById' | 'updateUserById' | 'deleteUser'> };
};

export type Account = {
  id: string; email: string | null; created_at: string; last_sign_in_at: string | null; providers: string[];
  banned_until: string | null; ban_reason: string | null;
  nickname: string | null; display_name: string | null; is_public: boolean | null;
  roles: string[]; titles: string[];
  forum_banned: boolean; forum_ban_until: string | null; forum_ban_reason: string | null;
  threads: number; posts: number; telegram: string | null; total: number;
};

const pageSize = 50;
const filters = ['all', 'banned', 'staff'];
const scopes = ['site', 'forum'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkId(id: string): string {
  if (!uuid.test(id)) throw new AccountError('Неверный ID аккаунта', 400);
  return id.toLowerCase();
}

export async function listAccounts(client: AccountClient, input: { q?: string; filter?: string; page?: string }) {
  const filter = input.filter || 'all';
  if (!filters.includes(filter)) throw new AccountError('Неизвестный фильтр', 400);
  const parsed = Number(input.page);
  const page = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  if (page > 100_000) throw new AccountError('Слишком большой номер страницы', 400);
  const { data, error } = await client.rpc('admin_accounts', {
    p_query: (input.q || '').trim().slice(0, 100) || null,
    p_filter: filter,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw error;
  const items = (data || []) as Account[];
  return { items, total: Number(items[0]?.total ?? 0), page, pageSize };
}

export async function getAccount(client: AccountClient, id: string): Promise<Account> {
  const { data, error } = await client.rpc('admin_accounts', { p_id: checkId(id), p_limit: 1 });
  if (error) throw error;
  const account = (data as Account[] | null)?.[0];
  if (!account) throw new AccountError('Аккаунт не найден', 404);
  return account;
}

async function protectedTarget(client: AccountClient, adminId: string, id: string): Promise<Account> {
  if (checkId(id) === adminId.toLowerCase()) throw new AccountError('Нельзя применить к своему аккаунту', 403);
  const account = await getAccount(client, id);
  if (account.roles.includes('admin')) throw new AccountError('Нельзя применить к администратору', 403);
  return account;
}

export function validateBan(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountError('Неверные данные', 400);
  const { scope, days, reason } = input as { scope?: unknown; days?: unknown; reason?: unknown };
  if (typeof scope !== 'string' || !scopes.includes(scope)) throw new AccountError('Неизвестный тип бана', 400);
  if (days !== null && !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 3650)) {
    throw new AccountError('Срок — от 1 до 3650 дней или навсегда', 400);
  }
  if (reason !== undefined && reason !== null && typeof reason !== 'string') throw new AccountError('Неверная причина', 400);
  const text = typeof reason === 'string' ? reason.trim() : '';
  if ([...text].length > 200) throw new AccountError('Причина длиннее 200 символов', 400);
  return { scope: scope as 'site' | 'forum', days: days as number | null, reason: text || null };
}

export async function banAccount(client: AccountClient, adminId: string, id: string, input: unknown, now = Date.now()) {
  const ban = validateBan(input);
  await protectedTarget(client, adminId, id);
  if (ban.scope === 'site') {
    const { error } = await client.auth.admin.updateUserById(id, {
      ban_duration: ban.days ? `${ban.days * 24}h` : '876000h',
      app_metadata: { ban_reason: ban.reason },
    });
    if (error) throw error;
  } else {
    const { error } = await client.from('forum_bans').upsert({
      user_id: id,
      until: ban.days ? new Date(now + ban.days * 86_400_000).toISOString() : null,
      reason: ban.reason,
      created_by: adminId,
      created_at: new Date(now).toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
  }
}

export async function unbanAccount(client: AccountClient, id: string, scope: string) {
  if (!scopes.includes(scope)) throw new AccountError('Неизвестный тип бана', 400);
  await getAccount(client, id);
  if (scope === 'site') {
    const { error } = await client.auth.admin.updateUserById(id, {
      ban_duration: 'none',
      app_metadata: { ban_reason: null },
    });
    if (error) throw error;
  } else {
    const { error } = await client.from('forum_bans').delete().eq('user_id', id);
    if (error) throw error;
  }
}

export async function adminDeleteAccount(client: AccountClient, adminId: string, id: string, confirm: unknown) {
  const account = await protectedTarget(client, adminId, id);
  // Аккаунт без профиля подтверждается его ID
  if (confirm !== (account.nickname || account.id)) {
    throw new AccountError('Введите ник аккаунта для подтверждения', 400);
  }
  await purgeAccount(client, account.id);
}

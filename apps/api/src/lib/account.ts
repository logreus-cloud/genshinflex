import type { SupabaseClient } from '@supabase/supabase-js';
import type { TokenClaims } from './auth.ts';

export type AdminClient = {
  from: SupabaseClient['from'];
  storage: Pick<SupabaseClient['storage'], 'from'>;
  auth: { admin: Pick<SupabaseClient['auth']['admin'], 'getUserById' | 'deleteUser'> };
};

function cleanMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/(token|secret|password)/i.test(key)
  ).map(([key, item]) => [key, cleanMetadata(item)]));
}

async function exportRows(client: AdminClient, table: string, key: string, id: string, columns: string[]) {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 1000) {
    const query = client.from(table).select('*').eq(key, id);
    for (const column of columns) query.order(column);
    const { data, error } = await query.range(offset, offset + 999);
    if (error || !data) throw new Error('Account export failed');
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function exportRelatedRows(client: AdminClient, table: string, key: string, ids: number[], columns: string[]) {
  const rows: unknown[] = [];
  for (let batch = 0; batch < ids.length; batch += 100) {
    for (let offset = 0; ; offset += 1000) {
      const query = client.from(table).select('*').in(key, ids.slice(batch, batch + 100));
      for (const column of columns) query.order(column);
      const { data, error } = await query.range(offset, offset + 999);
      if (error || !data) throw new Error('Account export failed');
      rows.push(...data);
      if (data.length < 1000) break;
    }
  }
  return rows;
}

export async function exportAccount(client: AdminClient, id: string) {
  const wishes: unknown[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('wishes').select('*').eq('user_id', id)
      .order('game_uid').order('id').range(offset, offset + 999);
    if (error || !data) throw new Error('Account export failed');
    wishes.push(...data);
    if (data.length < 1000) break;
  }
  const [threads, posts, reactions, reports, following, followers, requestedFriendships, receivedFriendships, blocks, notifications, ownMembers] = await Promise.all([
    exportRows(client, 'forum_threads', 'author_id', id, ['id']),
    exportRows(client, 'forum_posts', 'author_id', id, ['id']),
    exportRows(client, 'forum_reactions', 'user_id', id, ['post_id', 'kind']),
    exportRows(client, 'forum_reports', 'reporter_id', id, ['id']),
    exportRows(client, 'social_follows', 'follower_id', id, ['followee_id']),
    exportRows(client, 'social_follows', 'followee_id', id, ['follower_id']),
    exportRows(client, 'social_friendships', 'requester_id', id, ['requester_id', 'addressee_id']),
    exportRows(client, 'social_friendships', 'addressee_id', id, ['requester_id', 'addressee_id']),
    // Чужие блокировки не выгружаем, чтобы не раскрывать чужое решение.
    exportRows(client, 'social_blocks', 'blocker_id', id, ['blocked_id']),
    // Уведомления, адресованные другим, не выгружаем.
    exportRows(client, 'notifications', 'recipient_id', id, ['id']),
    exportRows(client, 'dm_members', 'user_id', id, ['conversation_id']),
  ]);
  const conversationIds = ownMembers.map((member) => (member as { conversation_id: number }).conversation_id);
  const [conversations, members, messages] = await Promise.all([
    exportRelatedRows(client, 'dm_conversations', 'id', conversationIds, ['id']),
    exportRelatedRows(client, 'dm_members', 'conversation_id', conversationIds, ['conversation_id', 'user_id']),
    exportRelatedRows(client, 'dm_messages', 'conversation_id', conversationIds, ['conversation_id', 'id']),
  ]);
  // social_rate_events — суточный технический антиспам, его не выгружаем.
  const [auth, profile, userData, roles, telegram, ban] = await Promise.all([
    client.auth.admin.getUserById(id),
    client.from('profiles').select('*').eq('id', id).maybeSingle(),
    client.from('user_data').select('*').eq('user_id', id).maybeSingle(),
    client.from('roles').select('*').eq('user_id', id),
    client.from('telegram_accounts').select('telegram_id,user_id,username,created_at,updated_at').eq('user_id', id).maybeSingle(),
    client.from('forum_bans').select('*').eq('user_id', id).maybeSingle(),
  ]);
  if (auth.error || !auth.data.user || profile.error || userData.error || roles.error || telegram.error
    || ban.error) {
    throw new Error('Account export failed');
  }
  const user = auth.data.user;
  return {
    auth: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      providers: (user.identities || []).map((identity) => ({
        provider: identity.provider,
        email: identity.identity_data?.email ?? null,
        name: identity.identity_data?.name ?? identity.identity_data?.full_name ?? null,
      })),
      user_metadata: cleanMetadata(user.user_metadata),
    },
    profile: profile.data,
    user_data: userData.data,
    wishes,
    roles: roles.data,
    telegram: telegram.data,
    forum: { threads, posts, reactions, reports, ban: ban.data },
    social: { following, followers, friendships: [...requestedFriendships, ...receivedFriendships], blocks },
    notifications,
    messages: { conversations, members, messages },
    exported_at: new Date().toISOString(),
  };
}

export function deletionCheck(confirm: unknown, claims: TokenClaims, now = Date.now()) {
  if (confirm !== 'DELETE') return 'confirmation_required';
  // Время создания JWT не заменяет время последнего входа.
  const latest = Math.max(...claims.amr.map((entry) => entry.timestamp));
  const age = now / 1000 - latest;
  if (!Number.isFinite(age) || age < 0 || age > 15 * 60) return 'reauth_required';
  return null;
}

async function mediaPaths(client: AdminClient, bucketName: string, folder: string): Promise<string[]> {
  const bucket = client.storage.from(bucketName);
  const paths: string[] = [];
  const visit = async (path: string): Promise<void> => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(path, { limit: 100, offset });
      if (error || !data) throw new Error('Media listing failed');
      for (const item of data) {
        const itemPath = `${path}/${item.name}`;
        if (item.id) paths.push(itemPath);
        else await visit(itemPath);
      }
      if (data.length < 100) break;
    }
  };
  await visit(folder);
  return paths;
}

export async function deleteAccount(client: AdminClient, id: string, confirm: unknown, claims: TokenClaims, now = Date.now()) {
  const check = deletionCheck(confirm, claims, now);
  if (check) return check;
  await purgeAccount(client, id);
  return null;
}

export async function purgeAccount(client: AdminClient, id: string) {
  for (const name of ['avatars', 'profile-media']) {
    const bucket = client.storage.from(name);
    const paths = await mediaPaths(client, name, id);
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await bucket.remove(paths.slice(offset, offset + 100));
      if (error) throw new Error('Media removal failed');
    }
  }
  const { error } = await client.auth.admin.deleteUser(id, false);
  if (error) throw new Error('Account removal failed');
}

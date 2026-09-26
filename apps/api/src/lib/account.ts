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

export async function exportAccount(client: AdminClient, id: string) {
  const [auth, profile, userData, roles, telegram] = await Promise.all([
    client.auth.admin.getUserById(id),
    client.from('profiles').select('*').eq('id', id).maybeSingle(),
    client.from('user_data').select('*').eq('user_id', id).maybeSingle(),
    client.from('roles').select('*').eq('user_id', id),
    client.from('telegram_accounts').select('telegram_id,user_id,username,created_at,updated_at').eq('user_id', id).maybeSingle(),
  ]);
  if (auth.error || !auth.data.user || profile.error || userData.error || roles.error || telegram.error) {
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
    roles: roles.data,
    telegram: telegram.data,
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

async function avatarPaths(client: AdminClient, folder: string): Promise<string[]> {
  const bucket = client.storage.from('avatars');
  const paths: string[] = [];
  const visit = async (path: string): Promise<void> => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(path, { limit: 100, offset });
      if (error || !data) throw new Error('Avatar listing failed');
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
  const bucket = client.storage.from('avatars');
  const paths = await avatarPaths(client, id);
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await bucket.remove(paths.slice(offset, offset + 100));
    if (error) throw new Error('Avatar removal failed');
  }
  const { error } = await client.auth.admin.deleteUser(id, false);
  if (error) throw new Error('Account removal failed');
  return null;
}

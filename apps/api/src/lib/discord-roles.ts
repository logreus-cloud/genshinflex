import type { SupabaseClient } from '@supabase/supabase-js';

// Linked Roles Discord: OAuth со scope role_connections.write, метаданные аккаунта GenshinFlex
// и их обновление по cron. Таблица и RPC — миграция 20261011125015_discord_role_connections.sql.

const API = 'https://discord.com/api/v10';
export const ROLE_SCOPES = 'identify role_connections.write';

export type RoleState = { discord_id: string; user_id: string; nickname: string; points: number; in_guild: boolean };
// Значения метаданных Discord принимает строками; username — ник на сайте (platform_username)
export type RoleMetadata = { linked: string; rating: string; guild: string; username: string };
type Tokens = { a: string; r: string; e: number };
type RoleClient = Pick<SupabaseClient, 'from' | 'rpc'>;
export type RoleConfig = { applicationId: string; clientSecret: string };

export class DiscordAuthError extends Error {}
class DiscordRateLimit extends Error {}

export function metadataOf(state: RoleState): RoleMetadata {
  return {
    linked: '1',
    rating: String(Math.max(0, Math.trunc(state.points))),
    guild: state.in_guild ? '1' : '0',
    username: state.nickname,
  };
}

const sameMetadata = (a: unknown, b: RoleMetadata) =>
  !!a && typeof a === 'object' && (['linked', 'rating', 'guild', 'username'] as const)
    .every((key) => (a as Record<string, unknown>)[key] === b[key]);

// Токены шифруются ключом из client secret: при смене секрета старые токены всё равно недействительны
async function tokenKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`genshinflex-linked-roles:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export async function encryptTokens(secret: string, tokens: Tokens): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(secret), new TextEncoder().encode(JSON.stringify(tokens)));
  const out = new Uint8Array(iv.length + data.byteLength);
  out.set(iv);
  out.set(new Uint8Array(data), iv.length);
  return toBase64(out);
}

export async function decryptTokens(secret: string, value: string): Promise<Tokens> {
  const bytes = fromBase64(value);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await tokenKey(secret), bytes.slice(12));
  const tokens = JSON.parse(new TextDecoder().decode(data)) as Tokens;
  if (typeof tokens.a !== 'string' || typeof tokens.r !== 'string' || typeof tokens.e !== 'number') throw new Error('Неверные токены');
  return tokens;
}

export function authorizeUrl(applicationId: string, redirectUri: string, state: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: applicationId, redirect_uri: redirectUri, response_type: 'code',
    scope: ROLE_SCOPES, state, prompt: 'consent',
  }).toString();
  return url.toString();
}

async function tokenRequest(fetchImpl: typeof fetch, config: RoleConfig, body: Record<string, string>, now: number): Promise<Tokens> {
  const response = await fetchImpl(`${API}/oauth2/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Basic ${btoa(`${config.applicationId}:${config.clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  if (response.status === 400 || response.status === 401) throw new DiscordAuthError(`token ${response.status}`);
  if (response.status === 429) throw new DiscordRateLimit();
  if (!response.ok) throw new Error(`token ${response.status}`);
  const data = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') throw new Error('Неверный ответ Discord');
  if (typeof data.scope === 'string' && !data.scope.split(' ').includes('role_connections.write')) throw new DiscordAuthError('scope');
  const expires = Number(data.expires_in);
  return { a: data.access_token, r: data.refresh_token, e: now + (Number.isFinite(expires) ? expires : 3600) * 1000 };
}

export function exchangeCode(fetchImpl: typeof fetch, config: RoleConfig, code: string, redirectUri: string, now = Date.now()) {
  return tokenRequest(fetchImpl, config, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, now);
}

export async function discordUserId(fetchImpl: typeof fetch, accessToken: string): Promise<string> {
  const response = await fetchImpl(`${API}/users/@me`, {
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`users/@me ${response.status}`);
  const user = await response.json() as { id?: unknown };
  if (typeof user.id !== 'string' || !/^[0-9]{5,25}$/.test(user.id)) throw new Error('Неверный Discord ID');
  return user.id;
}

export async function pushMetadata(
  fetchImpl: typeof fetch, applicationId: string, accessToken: string, metadata: RoleMetadata | null,
): Promise<void> {
  const body = metadata
    ? { platform_name: 'GenshinFlex', platform_username: metadata.username,
      metadata: { linked: metadata.linked, rating: metadata.rating, guild: metadata.guild } }
    : { platform_name: 'GenshinFlex', metadata: { linked: '0', rating: '0', guild: '0' } };
  const response = await fetchImpl(`${API}/users/@me/applications/${applicationId}/role-connection`, {
    method: 'PUT',
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) throw new DiscordAuthError(`role-connection ${response.status}`);
  if (response.status === 429) throw new DiscordRateLimit();
  if (!response.ok) throw new Error(`role-connection ${response.status}`);
}

async function loadStates(client: RoleClient, discordIds: string[]): Promise<Map<string, RoleState>> {
  const { data, error } = await client.rpc('discord_role_state', { p_discord_ids: discordIds });
  if (error) throw error;
  return new Map(((data ?? []) as RoleState[]).map((row) => [row.discord_id, row]));
}

export type LinkResult = { status: 'linked'; nickname: string } | { status: 'no_account' };

// Обработка возврата из OAuth: токены → Discord ID → аккаунт → метаданные → запись в базе
export async function completeLink(
  client: RoleClient, config: RoleConfig, code: string, redirectUri: string,
  fetchImpl: typeof fetch = fetch, now = Date.now(),
): Promise<LinkResult> {
  const tokens = await exchangeCode(fetchImpl, config, code, redirectUri, now);
  const discordId = await discordUserId(fetchImpl, tokens.a);
  const state = (await loadStates(client, [discordId])).get(discordId);
  if (!state) {
    // Без аккаунта сбрасываем метаданные: роль «привязан GenshinFlex» не выдаётся
    await pushMetadata(fetchImpl, config.applicationId, tokens.a, null);
    return { status: 'no_account' };
  }
  const metadata = metadataOf(state);
  await pushMetadata(fetchImpl, config.applicationId, tokens.a, metadata);
  const token = await encryptTokens(config.clientSecret, tokens);
  // Discord мог раньше принадлежать другому аккаунту сайта
  const removed = await client.from('discord_role_connections').delete().eq('discord_id', discordId).neq('user_id', state.user_id);
  if (removed.error) throw removed.error;
  const { error } = await client.from('discord_role_connections').upsert({
    user_id: state.user_id, discord_id: discordId, token, metadata, synced_at: new Date(now).toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
  return { status: 'linked', nickname: state.nickname };
}

type Row = { user_id: string; discord_id: string; token: string; metadata: unknown };

// Cron: сверяет метаданные и отправляет в Discord только изменившиеся
export async function syncRoleConnections(
  client: RoleClient, config: RoleConfig, fetchImpl: typeof fetch = fetch, now = Date.now(), limit = 50,
): Promise<{ checked: number; pushed: number; removed: number }> {
  const { data, error } = await client.from('discord_role_connections')
    .select('user_id,discord_id,token,metadata')
    .order('synced_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { checked: 0, pushed: 0, removed: 0 };
  const states = await loadStates(client, rows.map((row) => row.discord_id));
  let pushed = 0;
  let removed = 0;
  const remove = async (row: Row) => {
    const result = await client.from('discord_role_connections').delete().eq('user_id', row.user_id).eq('discord_id', row.discord_id);
    if (result.error) throw result.error;
    removed++;
  };
  for (const row of rows) {
    const state = states.get(row.discord_id);
    const current = state && state.user_id === row.user_id ? metadataOf(state) : null;
    const syncedAt = new Date(now).toISOString();
    try {
      if (current && sameMetadata(row.metadata, current)) {
        const result = await client.from('discord_role_connections').update({ synced_at: syncedAt }).eq('user_id', row.user_id);
        if (result.error) throw result.error;
        continue;
      }
      let tokens: Tokens;
      try {
        tokens = await decryptTokens(config.clientSecret, row.token);
      } catch {
        await remove(row);
        continue;
      }
      let refreshed = false;
      if (tokens.e - 60_000 <= now) {
        tokens = await tokenRequest(fetchImpl, config, { grant_type: 'refresh_token', refresh_token: tokens.r }, now);
        refreshed = true;
      }
      await pushMetadata(fetchImpl, config.applicationId, tokens.a, current);
      // Discord отвязан от аккаунта: метаданные сброшены, запись больше не нужна
      if (!current) {
        await remove(row);
        continue;
      }
      const result = await client.from('discord_role_connections').update({
        metadata: current, synced_at: syncedAt,
        ...(refreshed ? { token: await encryptTokens(config.clientSecret, tokens) } : {}),
      }).eq('user_id', row.user_id);
      if (result.error) throw result.error;
      pushed++;
    } catch (failure) {
      if (failure instanceof DiscordRateLimit) break;
      // Пользователь отозвал доступ приложения в Discord
      if (failure instanceof DiscordAuthError) {
        await remove(row);
        continue;
      }
      console.warn('discord role sync failed', row.discord_id, String(failure));
    }
  }
  if (pushed || removed) console.log('discord linked roles', { checked: rows.length, pushed, removed });
  return { checked: rows.length, pushed, removed };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function rolePage(title: string, text: string, link?: { href: string; label: string }): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — GenshinFlex</title><meta name="robots" content="noindex">
<style>:root{color-scheme:light dark;--bg:#f6f3ec;--fg:#1d1b18;--panel:#fff;--gold:#a8874a}
@media (prefers-color-scheme:dark){:root{--bg:#14161c;--fg:#ece6da;--panel:#1d2029;--gold:#d3bc8e}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:440px;background:var(--panel);border-radius:12px;padding:24px;border-top:3px solid var(--gold)}
h1{font-size:1.3rem;margin:0 0 .5rem}a{color:var(--gold)}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${link ? `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>` : ''}</main></body></html>`;
}

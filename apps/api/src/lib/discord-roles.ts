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

const LEASE_MS = 120_000;

// Аренда записи: одну запись в каждый момент обрабатывает один владелец (cron или OAuth callback).
// Все изменения условны по владельцу, а запись токенов ещё и по прочитанному token (версии)
// until — нижняя оценка срока аренды: время до запроса к базе + LEASE_MS или lease_until из базы
function leaseOf(client: RoleClient, discordId: string, owner: string, token: string, until: number) {
  const lease = {
    token,
    // Перед внешним запросом: если аренда почти истекла — продлить; не вышло — запись уже не наша
    async extend(): Promise<boolean> {
      if (until - Date.now() > 30_000) return true;
      const requested = Date.now();
      const next = requested + LEASE_MS;
      const { data, error } = await client.from('discord_role_connections')
        .update({ lease_until: new Date(next).toISOString() })
        .eq('discord_id', discordId).eq('lease_owner', owner).select('discord_id').maybeSingle();
      if (error) throw error;
      if (!data) return false;
      until = next;
      return until - Date.now() > 30_000;
    },
    async update(value: Record<string, unknown>): Promise<boolean> {
      const { data, error } = await client.from('discord_role_connections').update(value)
        .eq('discord_id', discordId).eq('token', lease.token).eq('lease_owner', owner)
        .select('discord_id').maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async remove(): Promise<boolean> {
      const { data, error } = await client.from('discord_role_connections').delete()
        .eq('discord_id', discordId).eq('lease_owner', owner).select('discord_id').maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async release(checked: boolean): Promise<void> {
      const { error } = await client.from('discord_role_connections').update({
        lease_owner: null, lease_until: null, ...(checked ? { checked_at: new Date().toISOString() } : {}),
      }).eq('discord_id', discordId).eq('lease_owner', owner);
      if (error) throw error;
    },
  };
  return lease;
}

async function releaseQuietly(lease: ReturnType<typeof leaseOf>, discordId: string, checked: boolean) {
  try {
    await lease.release(checked);
  } catch (failure) {
    console.warn('discord role lease release failed', discordId, String(failure));
  }
}

// Обработка возврата из OAuth: токены → Discord ID → аренда записи → актуальное состояние аккаунта → метаданные
export async function completeLink(
  client: RoleClient, config: RoleConfig, code: string, redirectUri: string,
  fetchImpl: typeof fetch = fetch, now = Date.now(),
): Promise<LinkResult> {
  const tokens = await exchangeCode(fetchImpl, config, code, redirectUri, now);
  const discordId = await discordUserId(fetchImpl, tokens.a);
  const owner = crypto.randomUUID();
  const token = await encryptTokens(config.clientSecret, tokens);
  const requested = Date.now();
  const { data: leased, error } = await client.rpc('discord_role_lease', {
    p_discord_id: discordId, p_token: token, p_owner: owner,
  });
  if (error) throw error;
  if (!leased) throw new Error('Запись Discord уже обрабатывается');
  const lease = leaseOf(client, discordId, owner, token, requested + LEASE_MS);
  try {
    // Состояние читаем только под арендой: до неё Discord могли привязать или отвязать
    const state = (await loadStates(client, [discordId])).get(discordId);
    if (!state) {
      // Без аккаунта сбрасываем метаданные: роль «привязан GenshinFlex» не выдаётся
      if (!await lease.extend()) throw new Error('Аренда записи Discord потеряна');
      await pushMetadata(fetchImpl, config.applicationId, tokens.a, null);
      if (!await lease.remove()) throw new Error('Аренда записи Discord потеряна');
      return { status: 'no_account' };
    }
    if (!await lease.update({ user_id: state.user_id })) throw new Error('Аренда записи Discord потеряна');
    const metadata = metadataOf(state);
    if (!await lease.extend()) throw new Error('Аренда записи Discord потеряна');
    await pushMetadata(fetchImpl, config.applicationId, tokens.a, metadata);
    const at = new Date().toISOString();
    await lease.update({ metadata, synced_at: at, checked_at: at });
    await lease.release(false);
    return { status: 'linked', nickname: state.nickname };
  } catch (failure) {
    // Без отметки checked_at: cron доберётся до записи сразу после снятия аренды
    await releaseQuietly(lease, discordId, false);
    throw failure;
  }
}

type Row = { user_id: string | null; discord_id: string; token: string; metadata: unknown; synced_at: string | null; lease_until: string | null };

// Cron: по одной записи под арендой сверяет метаданные и подтверждает доступ к Discord не реже раза в сутки
export async function syncRoleConnections(
  client: RoleClient, config: RoleConfig, fetchImpl: typeof fetch = fetch, limit = 25, budgetMs = 45_000,
): Promise<{ checked: number; pushed: number; removed: number }> {
  const started = Date.now();
  const owner = crypto.randomUUID();
  let checked = 0;
  let pushed = 0;
  let removed = 0;
  while (checked < limit && Date.now() - started < budgetMs) {
    const { data, error } = await client.rpc('discord_role_claim', { p_owner: owner });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
    if (!row) break;
    checked++;
    const leasedUntil = row.lease_until ? Date.parse(row.lease_until) : Number.NaN;
    const lease = leaseOf(client, row.discord_id, owner, row.token, Number.isFinite(leasedUntil) ? leasedUntil : 0);
    let stop = false;
    try {
      const state = (await loadStates(client, [row.discord_id])).get(row.discord_id);
      const current = state && state.user_id === row.user_id ? metadataOf(state) : null;
      if (current && sameMetadata(row.metadata, current) && row.synced_at
        && Date.now() - Date.parse(row.synced_at) < 86_400_000) continue;
      let tokens: Tokens;
      try {
        tokens = await decryptTokens(config.clientSecret, row.token);
      } catch {
        if (await lease.remove()) removed++;
        continue;
      }
      let refreshed = false;
      const refresh = async () => {
        if (!await lease.extend()) return false;
        const next = await tokenRequest(fetchImpl, config,
          { grant_type: 'refresh_token', refresh_token: tokens.r }, Date.now());
        const token = await encryptTokens(config.clientSecret, next);
        if (!await lease.update({ token })) return false;
        lease.token = token;
        tokens = next;
        refreshed = true;
        return true;
      };
      const push = async () => {
        if (!await lease.extend()) return false;
        await pushMetadata(fetchImpl, config.applicationId, tokens.a, current);
        return true;
      };
      if (tokens.e - 60_000 <= Date.now() && !await refresh()) continue;
      try {
        if (!await push()) continue;
      } catch (failure) {
        if (!(failure instanceof DiscordAuthError) || refreshed) throw failure;
        if (!await refresh() || !await push()) continue;
      }
      // Discord отвязан от аккаунта или аккаунт удалён: метаданные сброшены, запись больше не нужна
      if (!current) {
        if (await lease.remove()) removed++;
        continue;
      }
      if (await lease.update({ metadata: current, synced_at: new Date().toISOString() })) pushed++;
    } catch (failure) {
      if (failure instanceof DiscordAuthError) {
        // Пользователь отозвал доступ приложения в Discord
        try {
          if (await lease.remove()) removed++;
        } catch (removeFailure) {
          console.warn('discord role remove failed', row.discord_id, String(removeFailure));
        }
      } else if (failure instanceof DiscordRateLimit) {
        stop = true;
      } else {
        console.warn('discord role sync failed', row.discord_id, String(failure));
      }
    } finally {
      await releaseQuietly(lease, row.discord_id, true);
    }
    if (stop) break;
  }
  if (pushed || removed) console.log('discord linked roles', { checked, pushed, removed });
  return { checked, pushed, removed };
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

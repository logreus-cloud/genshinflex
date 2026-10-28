import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { claimsFromToken } from './lib/auth.ts';
import type { TokenClaims } from './lib/auth.ts';
import { deleteAccount, exportAccount } from './lib/account.ts';
import type { AdminClient } from './lib/account.ts';
import {
  AccountError, adminDeleteAccount, banAccount, getAccount, listAccounts, unbanAccount,
} from './lib/accounts.ts';
import type { AccountClient } from './lib/accounts.ts';
import type { Env } from './lib/env.ts';
import { createBuildsLoader, createJsonLoader, handleInteraction, verifyDiscordRequest } from './lib/discord.ts';
import type { DiscordBuild, DiscordInteraction } from './lib/discord.ts';
import { loadDiscordProfile } from './lib/discord-profile.ts';
import type { PublicProfileCard } from './lib/discord-profile.ts';
import { deliverDiscordNotifications } from './lib/discord-notify.ts';
import { isPityData, parseBannersData } from './lib/discord-wishes.ts';
import { authorizeUrl, completeLink, rolePage, syncRoleConnections } from './lib/discord-roles.ts';
import type { TicketDeps } from './lib/discord-tickets.ts';
import type { LinkResult } from './lib/discord-roles.ts';
import type { DiscordBannersData, PityData } from './lib/discord-wishes.ts';
import { dispatchSanityPublish } from './lib/github-dispatch.ts';
import { collectProfileMedia } from './lib/profile-media-gc.ts';
import { verifySanityWebhook } from './lib/sanity-webhook.ts';
import { verifyTelegram } from './lib/telegram.ts';
import { linkTelegram, telegramLogin, unlinkTelegram } from './lib/telegram-login.ts';
import { deliverTelegramNotifications } from './lib/telegram-notify.ts';
import { RewardError, getUserRewards, grantReward, listRewards, revokeReward } from './lib/rewards.ts';
import {
  TitleError, createTitle, deleteTitle, getUserRoles, getUserTitles, grantTitle,
  listAdminTitles, listTitles, revokeTitle, searchUsers, setActiveTitle,
} from './lib/titles.ts';
import type { TitleClient } from './lib/titles.ts';

const app = new Hono<ApiEnv>();
const version = '0.23.0';

export type ServiceClient = AdminClient & AccountClient & TitleClient & Parameters<typeof telegramLogin>[0];
type ApiEnv = {
  Bindings: Env;
  Variables: {
    adminClient: (c: ApiContext) => ServiceClient | Response;
    claims: typeof claimsFromToken;
    discordBuilds: (url: string) => Promise<DiscordBuild[]>;
    discordProfile: (nickname: string, env: Env, signal: AbortSignal, auxiliaryDeadline: number) => Promise<PublicProfileCard | null>;
    discordLinkedProfile: (discordId: string, env: Env, signal: AbortSignal) => Promise<{ nickname: string; is_public: boolean } | null>;
    discordBanners: (url: string) => Promise<DiscordBannersData>;
    discordPity: (discordId: string, env: Env, signal: AbortSignal) => Promise<PityData | null>;
    discordRoleLink: (code: string, redirectUri: string, env: Env) => Promise<LinkResult>;
    discordTicketClient: (env: Env) => ReturnType<TicketDeps['client']>;
    discordTicketFetch: typeof fetch;
    discordTicketWaitUntil: (c: ApiContext, promise: Promise<unknown>) => void;
  };
};
type ApiContext = Context<ApiEnv>;
type AppDeps = Partial<ApiEnv['Variables']>;

const discordLoaders = new Map<string, ReturnType<typeof createBuildsLoader>>();
const bannerLoaders = new Map<string, () => Promise<DiscordBannersData>>();

function createServiceClient(env: Env): ServiceClient & Pick<SupabaseClient, 'rpc'> {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function defaultClient(c: ApiContext): ServiceClient | Response {
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Сервис недоступен' }, 503);
  }
  return createServiceClient(c.env);
}

function serviceClient(c: ApiContext): ServiceClient | Response {
  return c.get('adminClient')(c);
}

async function limitedBody(c: ApiContext, limit: number): Promise<string | Response> {
  const length = c.req.header('Content-Length');
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    return c.json({ error: 'Слишком большое тело запроса' }, 413);
  }
  const stream = c.req.raw.body;
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel().catch(() => undefined);
      return c.json({ error: 'Слишком большое тело запроса' }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function banFailure(c: ApiContext, user: string): Promise<Response | null> {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  try {
    const { data, error } = await client.auth.admin.getUserById(user);
    if (error || !data.user) return c.json({ error: 'Сервис недоступен' }, 503);
    if (data.user.banned_until && Date.parse(data.user.banned_until) > Date.now()) {
      return c.json({ error: 'Аккаунт заблокирован' }, 403);
    }
  } catch {
    return c.json({ error: 'Сервис недоступен' }, 503);
  }
  return null;
}

export async function requireUser(
  c: ApiContext, resolve = claimsFromToken,
): Promise<TokenClaims | Response> {
  const token = /^Bearer (.+)$/i.exec(c.req.header('Authorization') || '')?.[1];
  if (!token) return c.json({ error: 'Требуется авторизация' }, 401);
  const claims = await resolve(token, c.env);
  if (!claims) return c.json({ error: 'Требуется авторизация' }, 401);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method || 'GET')) {
    const failure = await banFailure(c, claims.sub);
    if (failure) return failure;
  }
  return claims;
}

export async function requireAdmin(
  c: ApiContext, client: TitleClient, resolve = claimsFromToken,
): Promise<TokenClaims | Response> {
  const user = await requireUser(c, resolve);
  if (user instanceof Response) return user;
  const { data, error } = await client.from('roles').select('role')
    .eq('user_id', user.sub).eq('role', 'admin').maybeSingle();
  if (error) return c.json({ error: 'Сервис недоступен' }, 503);
  if (!data) return c.json({ error: 'Нужны права администратора' }, 403);
  // Забаненный читает свой профиль, но админку не видит ни на каком методе
  if (['GET', 'HEAD'].includes(c.req.method || 'GET')) {
    const failure = await banFailure(c, user.sub);
    if (failure) return failure;
  }
  return user;
}

function titleFailure(c: ApiContext, error: unknown): Response {
  if (error instanceof TitleError) return c.json({ error: error.message }, error.status);
  return c.json({ error: 'Внутренняя ошибка' }, 500);
}

async function titleBody(c: ApiContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new TitleError('Неверный JSON', 400);
  }
}

function rewardFailure(c: ApiContext, error: unknown): Response {
  if (error instanceof RewardError) return c.json({ error: error.message }, error.status);
  return c.json({ error: 'Внутренняя ошибка' }, 500);
}

async function rewardBody(c: ApiContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new RewardError('Неверный JSON', 400);
  }
}

function logAdminAction(admin: string, action: string, target: string): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), admin, action, target }));
}

function loadDiscordBuilds(url: string): Promise<DiscordBuild[]> {
  let loader = discordLoaders.get(url);
  if (!loader) {
    loader = createBuildsLoader(url);
    discordLoaders.set(url, loader);
  }
  return loader();
}

function loadDiscordPublicProfile(
  nickname: string, env: Env, signal: AbortSignal, auxiliaryDeadline: number,
): Promise<PublicProfileCard | null> {
  const anonKey = (env as Env & { SUPABASE_ANON_KEY?: string }).SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !anonKey) throw new Error('Нет публичного клиента Supabase');
  const client = createClient(env.SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return loadDiscordProfile(client, nickname, 'https://genshinflex.com', fetch, signal, auxiliaryDeadline);
}

async function findDiscordLinkedProfile(discordId: string, env: Env, signal: AbortSignal) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Нет сервисного клиента Supabase');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc('discord_profile', { p_discord_id: discordId }).abortSignal(signal);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row && typeof row.nickname === 'string' && typeof row.is_public === 'boolean' ? row : null;
}

function loadDiscordBanners(url: string): Promise<DiscordBannersData> {
  let loader = bannerLoaders.get(url);
  if (!loader) {
    loader = createJsonLoader(url, parseBannersData);
    bannerLoaders.set(url, loader);
  }
  return loader();
}

async function loadDiscordPity(discordId: string, env: Env, signal: AbortSignal): Promise<PityData | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Нет сервисного клиента Supabase');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc('discord_wish_pity', { p_discord_id: discordId }).abortSignal(signal);
  if (error) throw error;
  if (data === null) return null;
  if (!isPityData(data)) throw new Error('Неверные данные гаранта');
  return data;
}

function linkDiscordRoles(code: string, redirectUri: string, env: Env): Promise<LinkResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Нет сервисного клиента Supabase');
  return completeLink(createServiceClient(env), {
    applicationId: env.DISCORD_APPLICATION_ID || '', clientSecret: env.DISCORD_CLIENT_SECRET || '',
  }, code, redirectUri);
}

app.use('*', async (c, next) => {
  if (c.req.path === '/discord/interactions') return next();
  const origin = c.req.header('Origin');
  const allowed = origin && c.env.SITE_ORIGINS?.split(',').map((item) => item.trim()).includes(origin);
  if (!allowed) return next();

  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Vary', 'Origin');
  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return c.body(null, 204);
  }
  return next();
});

app.get('/health', (c) => c.json({ ok: true, version }));

app.post('/discord/interactions', async (c) => {
  if (!c.env.DISCORD_PUBLIC_KEY) return c.json({ error: 'Сервис недоступен' }, 503);
  const body = await limitedBody(c, 64 * 1024);
  if (body instanceof Response) return body;
  const signature = c.req.header('X-Signature-Ed25519');
  const timestamp = c.req.header('X-Signature-Timestamp');
  if (!signature || !timestamp || !await verifyDiscordRequest(c.env.DISCORD_PUBLIC_KEY, signature, timestamp, body)) {
    return c.json({ error: 'Неверная подпись' }, 401);
  }
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))
    || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) {
    return c.json({ error: 'Неверная подпись' }, 401);
  }
  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(body) as DiscordInteraction;
  } catch {
    return c.json({ error: 'Неверный JSON' }, 400);
  }
  const url = c.env.DISCORD_DATA_URL || 'https://genshinflex.com/data/discord-builds.json';
  const bannersUrl = c.env.DISCORD_BANNERS_URL || 'https://genshinflex.com/data/discord-banners.json';
  return c.json(await handleInteraction(interaction, {
    loadBuilds: () => c.get('discordBuilds')(url), site: 'https://genshinflex.com',
    loadProfile: (nickname, signal, deadline) => c.get('discordProfile')(nickname, c.env, signal, deadline),
    findLinkedProfile: (discordId, signal) => c.get('discordLinkedProfile')(discordId, c.env, signal),
    loadBanners: () => c.get('discordBanners')(bannersUrl),
    loadPity: (discordId, signal) => c.get('discordPity')(discordId, c.env, signal),
    ticket: {
      client: () => c.get('discordTicketClient')(c.env),
      fetchImpl: c.get('discordTicketFetch'),
      waitUntil: (promise) => c.get('discordTicketWaitUntil')(c, promise),
      findLinkedProfile: (discordId, signal) => c.get('discordLinkedProfile')(discordId, c.env, signal),
      channelId: c.env.DISCORD_SUPPORT_CHANNEL_ID,
      botToken: c.env.DISCORD_BOT_TOKEN,
      applicationId: c.env.DISCORD_APPLICATION_ID,
      supportRoleIds: (c.env.DISCORD_SUPPORT_ROLE_IDS || '').split(',')
        .map((id) => id.trim()).filter((id) => /^[0-9]{5,25}$/.test(id)),
    },
  }));
});

// Linked Roles: URL верификации в настройках Discord-приложения ведёт сюда
const ROLE_COOKIE = 'gf_linked_role';
const roleRedirectUri = (c: ApiContext) => new URL('/discord/linked-role/callback', c.req.url).toString();

app.get('/discord/linked-role', (c) => {
  if (!c.env.DISCORD_APPLICATION_ID || !c.env.DISCORD_CLIENT_SECRET) {
    return c.html(rolePage('Сервис недоступен', 'Роли GenshinFlex временно недоступны, попробуйте позже.'), 503);
  }
  const state = crypto.randomUUID();
  setCookie(c, ROLE_COOKIE, state, { path: '/discord/linked-role', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600 });
  return c.redirect(authorizeUrl(c.env.DISCORD_APPLICATION_ID, roleRedirectUri(c), state));
});

app.get('/discord/linked-role/callback', async (c) => {
  const saved = getCookie(c, ROLE_COOKIE);
  deleteCookie(c, ROLE_COOKIE, { path: '/discord/linked-role', secure: true });
  const { code, state, error } = c.req.query();
  if (error) return c.html(rolePage('Подключение отменено', 'Роли GenshinFlex не подключены. Откройте Linked Roles в Discord, если передумаете.'));
  if (!code || !state || !saved || state !== saved) {
    return c.html(rolePage('Ссылка устарела', 'Откройте Linked Roles в Discord ещё раз.'), 400);
  }
  if (!c.env.DISCORD_APPLICATION_ID || !c.env.DISCORD_CLIENT_SECRET) {
    return c.html(rolePage('Сервис недоступен', 'Роли GenshinFlex временно недоступны, попробуйте позже.'), 503);
  }
  try {
    const result = await c.get('discordRoleLink')(code, roleRedirectUri(c), c.env);
    if (result.status === 'no_account') {
      return c.html(rolePage('Discord не привязан к GenshinFlex',
        'Войдите на сайт и привяжите Discord в настройках аккаунта, затем откройте Linked Roles в Discord снова.',
        { href: 'https://genshinflex.com/account/', label: 'Настройки аккаунта' }));
    }
    return c.html(rolePage('Готово', `Аккаунт @${result.nickname} подключён. Вернитесь в Discord: роли появятся в течение минуты.`));
  } catch (failure) {
    console.warn('discord linked role failed', String(failure));
    return c.html(rolePage('Не получилось', 'Не удалось подключить роли GenshinFlex. Попробуйте ещё раз чуть позже.'), 502);
  }
});

app.get('/titles', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  try {
    const titles = await listTitles(client);
    return c.json(titles, 200, { 'Cache-Control': 'public, max-age=300' });
  } catch (error) {
    return titleFailure(c, error);
  }
});

app.get('/me', async (c) => {
  const user = await requireUser(c, c.get('claims'));
  if (user instanceof Response) return user;
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const { data, error } = await client.from('profiles').select('*').eq('id', user.sub).single();
  if (error || !data) return c.json({ error: 'Профиль не найден' }, 404);
  try {
    const [titles, roles, rewards] = await Promise.all([
      getUserTitles(client, user.sub),
      getUserRoles(client, user.sub),
      getUserRewards(client, user.sub),
    ]);
    return c.json({ ...data, titles, roles, rewards });
  } catch (failure) {
    return titleFailure(c, failure);
  }
});

app.post('/me/title', async (c) => {
  const user = await requireUser(c, c.get('claims'));
  if (user instanceof Response) return user;
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  try {
    return c.json(await setActiveTitle(client, user.sub, await titleBody(c)));
  } catch (error) {
    return titleFailure(c, error);
  }
});

app.get('/admin/titles', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    return c.json(await listAdminTitles(client));
  } catch (error) {
    return titleFailure(c, error);
  }
});

app.get('/admin/rewards', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    return c.json(await listRewards(client));
  } catch (error) {
    return rewardFailure(c, error);
  }
});

app.post('/admin/titles', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    const title = await createTitle(client, await titleBody(c), admin.sub);
    logAdminAction(admin.sub, 'create_title', title.id);
    return c.json(title, 201);
  } catch (error) {
    return titleFailure(c, error);
  }
});

app.delete('/admin/titles/:id', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    const result = await deleteTitle(client, c.req.param('id'));
    logAdminAction(admin.sub, 'delete_title', c.req.param('id'));
    return c.json(result);
  } catch (error) {
    return titleFailure(c, error);
  }
});

app.get('/admin/users', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    return c.json(await searchUsers(client, c.req.query('q') || ''));
  } catch (error) {
    return titleFailure(c, error);
  }
});

app.post('/admin/users/:userId/titles', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    const body = await titleBody(c);
    const result = await grantTitle(client, c.req.param('userId'), body, admin.sub);
    const title = (body as { title: string }).title;
    logAdminAction(admin.sub, 'grant_title', `${c.req.param('userId')}:${title}`);
    return c.json(result, 201);
  } catch (error) {
    return titleFailure(c, error);
  }
});

app.delete('/admin/users/:userId/titles/:titleId', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    const result = await revokeTitle(client, c.req.param('userId'), c.req.param('titleId'));
    logAdminAction(admin.sub, 'revoke_title', `${c.req.param('userId')}:${c.req.param('titleId')}`);
    return c.json(result);
  } catch (error) {
    return titleFailure(c, error);
  }
});

app.post('/admin/users/:userId/rewards', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    const body = await rewardBody(c);
    const result = await grantReward(client, c.req.param('userId'), body, admin.sub);
    const reward = (body as { reward: string }).reward;
    logAdminAction(admin.sub, 'grant_reward', `${c.req.param('userId')}:${reward}`);
    return c.json(result, 201);
  } catch (error) {
    return rewardFailure(c, error);
  }
});

app.delete('/admin/users/:userId/rewards/:rewardId', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    const result = await revokeReward(client, c.req.param('userId'), c.req.param('rewardId'));
    logAdminAction(admin.sub, 'revoke_reward', `${c.req.param('userId')}:${c.req.param('rewardId')}`);
    return c.json(result);
  } catch (error) {
    return rewardFailure(c, error);
  }
});

function accountFailure(c: ApiContext, error: unknown): Response {
  if (error instanceof AccountError) return c.json({ error: error.message }, error.status);
  return c.json({ error: 'Внутренняя ошибка' }, 500);
}

app.get('/admin/accounts', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    return c.json(await listAccounts(client, {
      q: c.req.query('q'), filter: c.req.query('filter'), page: c.req.query('page'),
    }));
  } catch (error) {
    return accountFailure(c, error);
  }
});

app.get('/admin/accounts/:id', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    return c.json(await getAccount(client, c.req.param('id')));
  } catch (error) {
    return accountFailure(c, error);
  }
});

app.post('/admin/accounts/:id/ban', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Неверный JSON' }, 400);
  }
  try {
    await banAccount(client, admin.sub, c.req.param('id'), body);
    logAdminAction(admin.sub, `ban_${(body as { scope: string }).scope}`, c.req.param('id'));
    return c.json(await getAccount(client, c.req.param('id')));
  } catch (error) {
    return accountFailure(c, error);
  }
});

app.delete('/admin/accounts/:id/ban/:scope', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  try {
    await unbanAccount(client, c.req.param('id'), c.req.param('scope'));
    logAdminAction(admin.sub, `unban_${c.req.param('scope')}`, c.req.param('id'));
    return c.json(await getAccount(client, c.req.param('id')));
  } catch (error) {
    return accountFailure(c, error);
  }
});

app.delete('/admin/accounts/:id', async (c) => {
  const client = serviceClient(c);
  if (client instanceof Response) return client;
  const admin = await requireAdmin(c, client, c.get('claims'));
  if (admin instanceof Response) return admin;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Требуется подтверждение' }, 400);
  }
  const confirm = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as { confirm?: unknown }).confirm : undefined;
  try {
    await adminDeleteAccount(client, admin.sub, c.req.param('id'), confirm);
    logAdminAction(admin.sub, 'delete_account', c.req.param('id'));
    return c.json({ ok: true });
  } catch (error) {
    return accountFailure(c, error);
  }
});

app.get('/me/export', async (c) => {
  const claims = await requireUser(c, c.get('claims'));
  if (claims instanceof Response) return claims;
  const supabase = serviceClient(c);
  if (supabase instanceof Response) return supabase;
  try {
    const data = await exportAccount(supabase, claims.sub);
    return c.body(JSON.stringify(data), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="genshinflex-data.json"',
      'Cache-Control': 'no-store',
    });
  } catch {
    return c.json({ error: 'Не удалось выгрузить данные' }, 500);
  }
});

app.delete('/me', async (c) => {
  const claims = await requireUser(c, c.get('claims'));
  if (claims instanceof Response) return claims;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Требуется подтверждение' }, 400);
  }
  const confirm = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as { confirm?: unknown }).confirm : undefined;
  if (confirm !== 'DELETE') return c.json({ error: 'Требуется подтверждение' }, 400);
  const supabase = serviceClient(c);
  if (supabase instanceof Response) return supabase;
  try {
    const result = await deleteAccount(supabase, claims.sub, confirm, claims);
    if (result === 'reauth_required') {
      return c.json({ error: 'Требуется повторный вход', code: 'reauth_required' }, 401);
    }
    if (result === 'confirmation_required') return c.json({ error: 'Требуется подтверждение' }, 400);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: 'Не удалось удалить аккаунт' }, 500);
  }
});

const telegramConflicts: Record<string, string> = {
  telegram_taken: 'Этот Telegram уже привязан к другому аккаунту',
  telegram_already_linked: 'К аккаунту уже привязан другой Telegram',
  last_method: 'Нельзя отвязать последний способ входа',
};

function telegramFailure(c: ApiContext, error: unknown): Response {
  const code = (error as { code?: unknown } | null)?.code;
  if ((error as { status?: unknown } | null)?.status === 409 && typeof code === 'string' && telegramConflicts[code]) {
    return c.json({ error: telegramConflicts[code], code }, 409);
  }
  return c.json({ error: 'Сервис недоступен' }, 500);
}

app.post('/me/telegram', async (c) => {
  const claims = await requireUser(c, c.get('claims'));
  if (claims instanceof Response) return claims;
  const supabase = serviceClient(c);
  if (supabase instanceof Response) return supabase;
  if (!c.env.TELEGRAM_BOT_TOKEN) return c.json({ error: 'Сервис недоступен' }, 503);
  const raw = await limitedBody(c, 8 * 1024);
  if (raw instanceof Response) return raw;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'Неверный JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Неверные данные' }, 400);
  const telegram = await verifyTelegram((body as { auth?: unknown }).auth, c.env.TELEGRAM_BOT_TOKEN, Date.now(), 3_600_000);
  if (!telegram) return c.json({ error: 'Неверная подпись Telegram' }, 401);
  try {
    await linkTelegram(supabase, claims.sub, telegram);
    return c.json({ ok: true });
  } catch (error) {
    return telegramFailure(c, error);
  }
});

app.delete('/me/telegram', async (c) => {
  const claims = await requireUser(c, c.get('claims'));
  if (claims instanceof Response) return claims;
  const supabase = serviceClient(c);
  if (supabase instanceof Response) return supabase;
  try {
    await unlinkTelegram(supabase, claims.sub);
    return c.json({ ok: true });
  } catch (error) {
    return telegramFailure(c, error);
  }
});

app.post('/auth/telegram', async (c) => {
  const supabase = serviceClient(c);
  if (supabase instanceof Response) return supabase;
  if (!c.env.TELEGRAM_BOT_TOKEN) return c.json({ error: 'Сервис недоступен' }, 503);
  const raw = await limitedBody(c, 8 * 1024);
  if (raw instanceof Response) return raw;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'Неверный JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Неверные данные' }, 400);
  const input = body as { auth?: unknown; lang?: unknown };
  const telegram = await verifyTelegram(input.auth, c.env.TELEGRAM_BOT_TOKEN, Date.now(), 3_600_000);
  if (!telegram) return c.json({ error: 'Неверная подпись Telegram' }, 401);
  const auth = input.auth as Record<string, unknown>;
  try {
    const token_hash = await telegramLogin(supabase, {
      ...telegram,
      first_name: typeof auth.first_name === 'string' ? auth.first_name : undefined,
      last_name: typeof auth.last_name === 'string' ? auth.last_name : undefined,
      photo_url: typeof auth.photo_url === 'string' ? auth.photo_url : undefined,
    }, typeof input.lang === 'string' ? input.lang : undefined);
    return c.json({ ok: true, token_hash });
  } catch {
    return c.json({ error: 'Сервис недоступен' }, 500);
  }
});

app.post('/hooks/sanity', async (c) => {
  if (!c.env.SANITY_WEBHOOK_SECRET || !c.env.GITHUB_REPO || !c.env.GITHUB_DISPATCH_TOKEN) {
    return c.json({ error: 'Сервис недоступен' }, 503);
  }
  const body = await limitedBody(c, 256 * 1024);
  if (body instanceof Response) return body;
  const valid = await verifySanityWebhook(
    body, c.req.header('sanity-webhook-signature') || null, c.env.SANITY_WEBHOOK_SECRET,
  );
  if (!valid) return c.json({ error: 'Неверная подпись Sanity' }, 401);

  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    document = null;
  }
  const data = document && typeof document === 'object' && !Array.isArray(document)
    ? document as Record<string, unknown> : {};
  try {
    await dispatchSanityPublish(c.env, {
      ...(typeof data._type === 'string' ? { type: data._type } : {}),
      ...(typeof data._id === 'string' ? { id: data._id } : {}),
    });
  } catch {
    return c.json({ error: 'Не удалось запустить сборку' }, 502);
  }
  return c.json({ ok: true });
});

export function createApp(deps: AppDeps = {}) {
  const instance = new Hono<ApiEnv>();
  instance.use('*', async (c, next) => {
    c.set('adminClient', deps.adminClient || defaultClient);
    c.set('claims', deps.claims || claimsFromToken);
    c.set('discordBuilds', deps.discordBuilds || loadDiscordBuilds);
    c.set('discordProfile', deps.discordProfile || loadDiscordPublicProfile);
    c.set('discordLinkedProfile', deps.discordLinkedProfile || findDiscordLinkedProfile);
    c.set('discordBanners', deps.discordBanners || loadDiscordBanners);
    c.set('discordPity', deps.discordPity || loadDiscordPity);
    c.set('discordRoleLink', deps.discordRoleLink || linkDiscordRoles);
    c.set('discordTicketClient', deps.discordTicketClient || createServiceClient);
    // В Workers fetch нельзя вызывать как метод другого объекта (Illegal invocation) — оборачиваем
    c.set('discordTicketFetch', deps.discordTicketFetch || ((input, init) => fetch(input, init)));
    c.set('discordTicketWaitUntil', deps.discordTicketWaitUntil || ((context, promise) => context.executionCtx.waitUntil(promise)));
    return next();
  });
  instance.route('/', app);
  instance.notFound((c) => c.json({ error: 'Не найдено' }, 404));
  instance.onError((_error, c) => c.json({ error: 'Внутренняя ошибка' }, 500));
  return instance;
}

function scheduled(event: { scheduledTime?: number }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const client = createServiceClient(env);
  // Cron раз в минуту; очередь Linked Roles сама ограничивает частоту проверок
  const roles = env.DISCORD_APPLICATION_ID && env.DISCORD_CLIENT_SECRET;
  const mediaGc = new Date(event.scheduledTime ?? Date.now()).getUTCMinutes() === 17;
  ctx.waitUntil(Promise.allSettled([
    deliverTelegramNotifications(client, env.TELEGRAM_BOT_TOKEN),
    deliverDiscordNotifications(client, env.DISCORD_BOT_TOKEN || ''),
    roles ? syncRoleConnections(client, { applicationId: env.DISCORD_APPLICATION_ID!, clientSecret: env.DISCORD_CLIENT_SECRET! }) : null,
    mediaGc ? collectProfileMedia(client) : null,
  ]).then(([telegram, discord, linkedRoles, media]) => {
    if (telegram.status === 'rejected') console.error('telegram notifications failed', String(telegram.reason));
    if (discord.status === 'rejected') console.error('discord notifications failed', String(discord.reason));
    if (linkedRoles.status === 'rejected') console.error('discord linked roles failed', String(linkedRoles.reason));
    if (media.status === 'rejected') console.error('profile media gc failed', String(media.reason));
  }));
}

const api = createApp();
export default Object.assign(api, { scheduled });

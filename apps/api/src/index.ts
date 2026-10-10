import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { claimsFromToken } from './lib/auth.ts';
import type { TokenClaims } from './lib/auth.ts';
import { deleteAccount, exportAccount } from './lib/account.ts';
import type { AdminClient } from './lib/account.ts';
import {
  AccountError, adminDeleteAccount, banAccount, getAccount, listAccounts, unbanAccount,
} from './lib/accounts.ts';
import type { AccountClient } from './lib/accounts.ts';
import type { Env } from './lib/env.ts';
import { dispatchSanityPublish } from './lib/github-dispatch.ts';
import { verifySanityWebhook } from './lib/sanity-webhook.ts';
import { verifyTelegram } from './lib/telegram.ts';
import { telegramLogin } from './lib/telegram-login.ts';
import { deliverTelegramNotifications } from './lib/telegram-notify.ts';
import {
  TitleError, createTitle, deleteTitle, getUserRoles, getUserTitles, grantTitle,
  listAdminTitles, listTitles, revokeTitle, searchUsers, setActiveTitle,
} from './lib/titles.ts';
import type { TitleClient } from './lib/titles.ts';

const app = new Hono<ApiEnv>();
const version = '0.9.0';

export type ServiceClient = AdminClient & AccountClient & TitleClient & Parameters<typeof telegramLogin>[0];
type ApiEnv = {
  Bindings: Env;
  Variables: {
    adminClient: (c: ApiContext) => ServiceClient | Response;
    claims: typeof claimsFromToken;
  };
};
type ApiContext = Context<ApiEnv>;
type AppDeps = Partial<ApiEnv['Variables']>;

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

export async function requireUser(
  c: ApiContext, resolve = claimsFromToken,
): Promise<TokenClaims | Response> {
  const token = /^Bearer (.+)$/i.exec(c.req.header('Authorization') || '')?.[1];
  if (!token) return c.json({ error: 'Требуется авторизация' }, 401);
  const claims = await resolve(token, c.env);
  return claims || c.json({ error: 'Требуется авторизация' }, 401);
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

function logAdminAction(admin: string, action: string, target: string): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), admin, action, target }));
}

app.use('*', async (c, next) => {
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
    const [titles, roles] = await Promise.all([
      getUserTitles(client, user.sub),
      getUserRoles(client, user.sub),
    ]);
    return c.json({ ...data, titles, roles });
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

app.post('/auth/telegram', async (c) => {
  const supabase = serviceClient(c);
  if (supabase instanceof Response) return supabase;
  if (!c.env.TELEGRAM_BOT_TOKEN) return c.json({ error: 'Сервис недоступен' }, 503);
  let body: unknown;
  try {
    body = await c.req.json();
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
  const body = await c.req.text();
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
    return next();
  });
  instance.route('/', app);
  instance.notFound((c) => c.json({ error: 'Не найдено' }, 404));
  instance.onError((_error, c) => c.json({ error: 'Внутренняя ошибка' }, 500));
  return instance;
}

function scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  ctx.waitUntil(deliverTelegramNotifications(createServiceClient(env), env.TELEGRAM_BOT_TOKEN));
}

const api = createApp();
export default Object.assign(api, { scheduled });

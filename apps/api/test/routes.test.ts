import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/index.ts';
import type { TokenClaims } from '../src/lib/auth.ts';
import type { Env } from '../src/lib/env.ts';
import { grantTitle, revokeTitle } from '../src/lib/titles.ts';
import { adminId, fakeClient, userId } from './fake-client.ts';

const botToken = '123456:local-test';
const env = { SITE_ORIGINS: '', TELEGRAM_BOT_TOKEN: botToken } as Env;

const claims = async (token: string): Promise<TokenClaims | null> => {
  if (!['user', 'admin', 'stale'].includes(token)) return null;
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: token === 'admin' ? adminId : userId,
    iat: now,
    amr: [{ method: 'password', timestamp: now - (token === 'stale' ? 901 : 60) }],
  };
};

type Route = { method: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown; admin?: boolean };
const routes: Route[] = [
  { method: 'GET', path: '/me' },
  { method: 'POST', path: '/me/title', body: { title: null } },
  { method: 'GET', path: '/admin/titles', admin: true },
  { method: 'POST', path: '/admin/titles', body: {}, admin: true },
  { method: 'DELETE', path: '/admin/titles/test', admin: true },
  { method: 'GET', path: '/admin/users', admin: true },
  { method: 'POST', path: `/admin/users/${userId}/titles`, body: {}, admin: true },
  { method: 'DELETE', path: `/admin/users/${userId}/titles/test`, admin: true },
  { method: 'GET', path: '/admin/accounts', admin: true },
  { method: 'GET', path: `/admin/accounts/${userId}`, admin: true },
  { method: 'POST', path: `/admin/accounts/${userId}/ban`, body: { scope: 'forum', days: 1 }, admin: true },
  { method: 'DELETE', path: `/admin/accounts/${userId}/ban/forum`, admin: true },
  { method: 'DELETE', path: `/admin/accounts/${userId}`, body: { confirm: 'traveler' }, admin: true },
  { method: 'GET', path: '/me/export' },
  { method: 'DELETE', path: '/me', body: { confirm: 'DELETE' } },
  { method: 'POST', path: '/me/telegram', body: { auth: {} } },
  { method: 'DELETE', path: '/me/telegram' },
];

function send(
  app: ReturnType<typeof createApp>,
  route: Route,
  token?: string,
) {
  return app.request(route.path, {
    method: route.method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: route.body === undefined ? undefined : JSON.stringify(route.body),
  }, env);
}

test('проверяет доступ на каждом закрытом маршруте', async (t) => {
  const { client } = fakeClient();
  const injected = createApp({ adminClient: () => client, claims });
  const missing = createApp({ claims });
  for (const route of routes) {
    await t.test(`${route.method} ${route.path}`, async () => {
      assert.equal((await send(injected, route)).status, 401);
      assert.equal((await send(injected, route, 'invalid')).status, 401);
      if (route.admin) assert.equal((await send(injected, route, 'user')).status, 403);
      assert.equal((await send(missing, route, route.admin ? 'admin' : 'user')).status, 503);
    });
  }
});

test('отдаёт профиль с титулами и ролями', async () => {
  const { client } = fakeClient();
  const app = createApp({ adminClient: () => client, claims });
  const response = await send(app, { method: 'GET', path: '/me' }, 'user');
  assert.equal(response.status, 200);
  const me = await response.json();
  assert.equal(me.id, userId);
  assert.equal(me.nickname, 'traveler');
  assert.ok(Array.isArray(me.titles));
  assert.ok(Array.isArray(me.roles));
});

test('забаненный пользователь читает профиль, но не меняет его', async () => {
  const { client } = fakeClient();
  let checks = 0;
  const bannedClient = {
    ...client,
    auth: { ...client.auth, admin: {
      ...client.auth.admin,
      getUserById: async () => {
        checks++;
        return { data: { user: { banned_until: new Date(Date.now() + 60_000).toISOString() } }, error: null };
      },
    } },
  } as typeof client;
  const app = createApp({ adminClient: () => bannedClient, claims });
  assert.equal((await send(app, { method: 'GET', path: '/me' }, 'user')).status, 200);
  assert.equal(checks, 0);
  const response = await send(app, { method: 'POST', path: '/me/title', body: { title: null } }, 'user');
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Аккаунт заблокирован' });
  assert.equal(checks, 1);
  assert.equal((await send(app, { method: 'GET', path: '/me/export' }, 'user')).status, 403);
  assert.equal(checks, 2);
});

test('выгружает данные через подставленный клиент', async () => {
  const { client } = fakeClient();
  const exportClient = {
    ...client,
    from: ((table: string) => table === 'discord_role_connections'
      ? { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      : table === 'discord_tickets' ? { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }
      : client.from(table)) as typeof client.from,
  };
  const app = createApp({ adminClient: () => exportClient, claims });
  const response = await send(app, { method: 'GET', path: '/me/export' }, 'user');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="genshinflex-data.json"');
  const { exported_at, ...data } = await response.json();
  assert.ok(Date.parse(exported_at));
  assert.deepEqual(data, {
    auth: {
      id: userId,
      email: 'traveler@example.com',
      created_at: '2026-09-01',
      last_sign_in_at: null,
      providers: [],
      user_metadata: { display_name: 'Traveler' },
    },
    profile: { id: userId, nickname: 'traveler' },
    user_data: { user_id: userId, favorites: [] },
    wishes: [],
    roles: [],
    titles: [],
    rewards: [],
    telegram: null,
    discord_linked_roles: [],
    discord_tickets: [],
    forum: { threads: [], posts: [], reactions: [], reports: [], ban: null, views: [] },
    social: { following: [], followers: [], friendships: [], blocks: [] },
    notifications: [],
    messages: { conversations: [], members: [], messages: [] },
    guilds: { membership: [], owned: [] },
    map: { collected: [], markers: [] },
  });
});

test('удаляет аккаунт только после подтверждения и свежего входа', async () => {
  const { client, deleted } = fakeClient();
  const app = createApp({ adminClient: () => client, claims });
  const accepted = await send(app, { method: 'DELETE', path: '/me', body: { confirm: 'DELETE' } }, 'user');
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { ok: true });
  assert.deepEqual(deleted, [userId]);
  const unconfirmed = await send(app, { method: 'DELETE', path: '/me', body: {} }, 'user');
  assert.equal(unconfirmed.status, 400);
  const stale = await send(app, { method: 'DELETE', path: '/me', body: { confirm: 'DELETE' } }, 'stale');
  assert.equal(stale.status, 401);
  assert.deepEqual(await stale.json(), { error: 'Требуется повторный вход', code: 'reauth_required' });
  assert.deepEqual(deleted, [userId]);
});

async function telegramAuth() {
  const data = { id: '12345', username: 'traveler', auth_date: Math.floor(Date.now() / 1000) };
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const text = Object.entries(data).map(([name, value]) => `${name}=${value}`).sort().join('\n');
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { ...data, hash };
}

test('требует свежий вход для привязки и отвязки Telegram', async () => {
  const { client } = fakeClient();
  const linkedClient = {
    ...client,
    rpc: async (name: string) => ({ data: name === 'replay_guard_claim' ? true : 'ok', error: null }),
  } as typeof client;
  const app = createApp({ adminClient: () => linkedClient, claims });
  const auth = await telegramAuth();
  for (const route of [
    { method: 'POST', path: '/me/telegram', body: { auth } },
    { method: 'DELETE', path: '/me/telegram' },
  ] as Route[]) {
    const stale = await send(app, route, 'stale');
    assert.equal(stale.status, 403);
    assert.deepEqual(await stale.json(), {
      error: 'Войдите заново, чтобы изменить способ входа', code: 'reauth_required',
    });
    const fresh = await send(app, route, 'user');
    assert.equal(fresh.status, 200);
    assert.deepEqual(await fresh.json(), { ok: true });
  }
});

test('проверяет подпись Telegram и отклоняет повторное подтверждение', async () => {
  const { client } = fakeClient();
  const used = new Set<string>();
  const replayClient = {
    ...client,
    rpc: async (name: string, args: { p_key: string }) => {
      if (name !== 'replay_guard_claim') return { data: 'ok', error: null };
      const claimed = !used.has(args.p_key);
      used.add(args.p_key);
      return { data: claimed, error: null };
    },
  } as typeof client;
  const app = createApp({ adminClient: () => replayClient, claims });
  const auth = await telegramAuth();
  const invalid = await send(app, { method: 'POST', path: '/auth/telegram', body: { auth: { ...auth, username: 'attacker' } } });
  assert.equal(invalid.status, 401);
  const valid = await send(app, { method: 'POST', path: '/auth/telegram', body: { auth } });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { ok: true, token_hash: 'fake-token-hash' });
  const repeated = await send(app, { method: 'POST', path: '/auth/telegram', body: { auth } });
  assert.equal(repeated.status, 401);
  assert.deepEqual(await repeated.json(), {
    error: 'Подтверждение Telegram уже использовано. Войдите через Telegram ещё раз',
  });
});

test('ограничивает размер JSON в маршруте титула', async () => {
  const { client } = fakeClient();
  const app = createApp({ adminClient: () => client, claims });
  const response = await send(app, {
    method: 'POST', path: '/me/title', body: { title: 'a'.repeat(8 * 1024) },
  }, 'user');
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Слишком большое тело запроса' });
});

test('повтор вебхука Sanity не запускает сборку снова', async () => {
  const { client } = fakeClient();
  let claimsCount = 0;
  let dispatches = 0;
  const replayClient = {
    ...client,
    rpc: async () => ({ data: ++claimsCount === 1, error: null }),
  } as typeof client;
  const app = createApp({ adminClient: () => replayClient });
  const webhookEnv = {
    ...env, SANITY_WEBHOOK_SECRET: 'test-secret',
    GITHUB_REPO: 'owner/repo', GITHUB_DISPATCH_TOKEN: 'test-token',
  };
  const body = JSON.stringify({ _type: 'post', _id: 'post-1' });
  const timestamp = Date.now();
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(webhookEnv.SANITY_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const v1 = btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    dispatches++;
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    const request = () => app.request('/hooks/sanity', {
      method: 'POST', headers: { 'sanity-webhook-signature': `t=${timestamp},v1=${v1}` }, body,
    }, webhookEnv as Env);
    const first = await request();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true });
    const duplicate = await request();
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
    assert.equal(dispatches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('повторная выдача с активацией завершает прерванную выдачу', async () => {
  let inserts = 0;
  let updates = 0;
  let activeTitle: string | null = null;
  const client = {
    from: (table: string) => table === 'user_titles'
      ? { insert: async () => ({ error: ++inserts === 1 ? null : { code: '23505' } }) }
      : { update: (value: { active_title: string }) => {
        const query = {
          eq: () => query,
          is: () => query,
          then: (resolve: (result: { error: Error | null }) => unknown) => {
            const error = ++updates === 1 ? new Error('profile') : null;
            if (!error) activeTitle = value.active_title;
            return Promise.resolve(resolve({ error }));
          },
        };
        return query;
      } },
  } as unknown as Parameters<typeof grantTitle>[0];
  await assert.rejects(grantTitle(client, userId, { title: 'traveler' }, adminId), /profile/);
  assert.deepEqual(await grantTitle(client, userId, { title: 'traveler', activate: true }, adminId), { ok: true });
  await assert.rejects(grantTitle(client, userId, { title: 'traveler' }, adminId), { status: 409 });
  assert.equal(updates, 2);
  assert.equal(activeTitle, 'traveler');
});

test('отзыв титула выполняется через транзакционную функцию', async () => {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: 'other', error: null };
    },
  } as unknown as Parameters<typeof revokeTitle>[0];
  assert.deepEqual(await revokeTitle(client, userId, 'old'), { ok: true });
  assert.deepEqual(calls, [{ name: 'title_revoke', args: { p_user: userId, p_title: 'old' } }]);
});

test('отзыв невыданного титула возвращает 404', async () => {
  const client = {
    rpc: async () => ({ data: null, error: { message: 'title:not_granted' } }),
  } as unknown as Parameters<typeof revokeTitle>[0];
  await assert.rejects(revokeTitle(client, userId, 'old'), { status: 404 });
});

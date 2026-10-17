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

test('проверяет подпись Telegram перед входом', async () => {
  const { client } = fakeClient();
  const app = createApp({ adminClient: () => client, claims });
  const data = { id: '12345', username: 'traveler', auth_date: Math.floor(Date.now() / 1000) };
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const text = Object.entries(data).map(([name, value]) => `${name}=${value}`).sort().join('\n');
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const auth = { ...data, hash };
  const invalid = await send(app, { method: 'POST', path: '/auth/telegram', body: { auth: { ...auth, username: 'attacker' } } });
  assert.equal(invalid.status, 401);
  const valid = await send(app, { method: 'POST', path: '/auth/telegram', body: { auth } });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { ok: true, token_hash: 'fake-token-hash' });
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

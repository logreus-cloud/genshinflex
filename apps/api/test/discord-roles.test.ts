import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/index.ts';
import {
  authorizeUrl, completeLink, decryptTokens, encryptTokens, metadataOf, syncRoleConnections,
} from '../src/lib/discord-roles.ts';
import type { RoleState } from '../src/lib/discord-roles.ts';
import type { Env } from '../src/lib/env.ts';

const config = { applicationId: '1553420351973761115', clientSecret: 'secret' };
const userId = '11111111-1111-4111-8111-111111111111';
const discordId = '398436774873006080';
const state: RoleState = { discord_id: discordId, user_id: userId, nickname: 'traveler', points: 42, in_guild: true };

type Op = { table: string; op: string; value?: unknown; filters: [string, string, unknown][] };

// Цепочка запросов Supabase: запоминает операции, select отдаёт rows
function fakeClient(rows: unknown[], states: RoleState[]) {
  const ops: Op[] = [];
  const rpcCalls: unknown[] = [];
  const from = (table: string) => {
    const entry: Op = { table, op: 'select', filters: [] };
    const chain = {
      select: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: rows, error: null }),
      update: (value: unknown) => { entry.op = 'update'; entry.value = value; ops.push(entry); return chain; },
      delete: () => { entry.op = 'delete'; ops.push(entry); return chain; },
      upsert: (value: unknown) => { entry.op = 'upsert'; entry.value = value; ops.push(entry); return Promise.resolve({ error: null }); },
      eq: (column: string, value: unknown) => { entry.filters.push(['eq', column, value]); return chain; },
      neq: (column: string, value: unknown) => { entry.filters.push(['neq', column, value]); return chain; },
      then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  };
  const rpc = async (name: string, args: unknown) => {
    rpcCalls.push({ name, args });
    return { data: states, error: null };
  };
  return { client: { from, rpc } as any, ops, rpcCalls };
}

type Call = { url: string; method: string; body: string; auth: string };
function fakeFetch(responses: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const call = {
      url, method: init.method || 'GET', body: init.body ? String(init.body) : '',
      auth: new Headers(init.headers).get('Authorization') || '',
    };
    calls.push(call);
    const key = Object.keys(responses).find((part) => url.includes(part));
    if (!key) throw new Error(`unexpected ${url}`);
    return responses[key](call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tokenResponse = () => json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 604800, scope: 'identify role_connections.write' });

test('токены шифруются и не читаются другим секретом', async () => {
  const sealed = await encryptTokens('secret', { a: 'access', r: 'refresh', e: 123 });
  assert.ok(!sealed.includes('access'));
  assert.deepEqual(await decryptTokens('secret', sealed), { a: 'access', r: 'refresh', e: 123 });
  await assert.rejects(decryptTokens('другой', sealed));
});

test('ссылка авторизации просит role_connections.write', () => {
  const url = new URL(authorizeUrl(config.applicationId, 'https://api.genshinflex.com/discord/linked-role/callback', 'state-1'));
  assert.equal(url.searchParams.get('scope'), 'identify role_connections.write');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('client_id'), config.applicationId);
  assert.deepEqual(metadataOf(state), { linked: '1', rating: '42', guild: '1', username: 'traveler' });
});

test('подключение отправляет метаданные и сохраняет зашифрованные токены', async () => {
  const { client, ops } = fakeClient([], [state]);
  const { impl, calls } = fakeFetch({
    '/oauth2/token': tokenResponse,
    '/users/@me/applications/': () => json({}),
    '/users/@me': () => json({ id: discordId }),
  });
  const result = await completeLink(client, config, 'code-1', 'https://api.example/cb', impl, 1_000);
  assert.deepEqual(result, { status: 'linked', nickname: 'traveler' });
  assert.match(calls[0].body, /grant_type=authorization_code&code=code-1/);
  assert.equal(calls[0].auth, `Basic ${btoa(`${config.applicationId}:secret`)}`);
  const push = calls.find((call) => call.method === 'PUT')!;
  assert.equal(push.auth, 'Bearer new-access');
  assert.deepEqual(JSON.parse(push.body), {
    platform_name: 'GenshinFlex', platform_username: 'traveler', metadata: { linked: '1', rating: '42', guild: '1' },
  });
  const upsert = ops.find((op) => op.op === 'upsert')!;
  const row = upsert.value as { token: string; discord_id: string; user_id: string };
  assert.equal(row.discord_id, discordId);
  assert.equal(row.user_id, userId);
  assert.equal((await decryptTokens('secret', row.token)).r, 'new-refresh');
  assert.deepEqual(ops.find((op) => op.op === 'delete')!.filters, [['eq', 'discord_id', discordId], ['neq', 'user_id', userId]]);
});

test('без аккаунта метаданные сбрасываются и ничего не сохраняется', async () => {
  const { client, ops } = fakeClient([], []);
  const { impl, calls } = fakeFetch({
    '/oauth2/token': tokenResponse,
    '/users/@me/applications/': () => json({}),
    '/users/@me': () => json({ id: discordId }),
  });
  assert.deepEqual(await completeLink(client, config, 'code', 'https://api.example/cb', impl), { status: 'no_account' });
  assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'PUT')!.body).metadata, { linked: '0', rating: '0', guild: '0' });
  assert.equal(ops.length, 0);
});

test('cron не трогает Discord, если метаданные не изменились', async () => {
  const token = await encryptTokens('secret', { a: 'access', r: 'refresh', e: Date.now() + 86_400_000 });
  const { client, ops } = fakeClient([{ user_id: userId, discord_id: discordId, token, metadata: metadataOf(state) }], [state]);
  const { impl, calls } = fakeFetch({});
  assert.deepEqual(await syncRoleConnections(client, config, impl), { checked: 1, pushed: 0, removed: 0 });
  assert.equal(calls.length, 0);
  assert.deepEqual(Object.keys(ops[0].value as object), ['synced_at']);
});

test('cron обновляет истёкший токен и отправляет новые метаданные', async () => {
  const now = 10_000_000;
  const token = await encryptTokens('secret', { a: 'old', r: 'old-refresh', e: now - 1 });
  const { client, ops } = fakeClient([{ user_id: userId, discord_id: discordId, token, metadata: { ...metadataOf(state), rating: '1' } }], [state]);
  const { impl, calls } = fakeFetch({ '/oauth2/token': tokenResponse, '/role-connection': () => json({}) });
  assert.deepEqual(await syncRoleConnections(client, config, impl, now), { checked: 1, pushed: 1, removed: 0 });
  assert.match(calls[0].body, /grant_type=refresh_token&refresh_token=old-refresh/);
  assert.equal(calls[1].auth, 'Bearer new-access');
  const update = ops.find((op) => op.op === 'update')!.value as { token: string; metadata: unknown };
  assert.deepEqual(update.metadata, metadataOf(state));
  assert.equal((await decryptTokens('secret', update.token)).a, 'new-access');
});

test('cron сбрасывает роли отвязанного Discord и удаляет запись, отозванный доступ — тоже', async () => {
  const token = await encryptTokens('secret', { a: 'access', r: 'refresh', e: Date.now() + 86_400_000 });
  const unlinked = fakeClient([{ user_id: userId, discord_id: discordId, token, metadata: metadataOf(state) }], []);
  const reset = fakeFetch({ '/role-connection': () => json({}) });
  assert.deepEqual(await syncRoleConnections(unlinked.client, config, reset.impl), { checked: 1, pushed: 0, removed: 1 });
  assert.deepEqual(JSON.parse(reset.calls[0].body).metadata, { linked: '0', rating: '0', guild: '0' });
  assert.equal(unlinked.ops.at(-1)!.op, 'delete');

  const revoked = fakeClient([{ user_id: userId, discord_id: discordId, token, metadata: null }], [state]);
  const denied = fakeFetch({ '/role-connection': () => json({ message: '401: Unauthorized' }, 401) });
  assert.deepEqual(await syncRoleConnections(revoked.client, config, denied.impl), { checked: 1, pushed: 0, removed: 1 });

  const limited = fakeClient([
    { user_id: userId, discord_id: discordId, token, metadata: null },
    { user_id: userId, discord_id: discordId, token, metadata: null },
  ], [state]);
  const slow = fakeFetch({ '/role-connection': () => json({ retry_after: 10 }, 429) });
  assert.deepEqual(await syncRoleConnections(limited.client, config, slow.impl), { checked: 2, pushed: 0, removed: 0 });
  assert.equal(slow.calls.length, 1);
});

test('маршруты Linked Roles проверяют state из cookie', async () => {
  const env = { SITE_ORIGINS: '', DISCORD_APPLICATION_ID: config.applicationId, DISCORD_CLIENT_SECRET: 'secret' } as Env;
  let received: { code: string; redirectUri: string } | undefined;
  const app = createApp({
    discordRoleLink: async (code, redirectUri) => { received = { code, redirectUri }; return { status: 'linked', nickname: 'traveler' }; },
  });
  const start = await app.request('https://api.genshinflex.com/discord/linked-role', {}, env);
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get('Location')!);
  const stateValue = location.searchParams.get('state')!;
  assert.equal(location.searchParams.get('redirect_uri'), 'https://api.genshinflex.com/discord/linked-role/callback');
  assert.match(start.headers.get('Set-Cookie')!, /gf_linked_role=.+HttpOnly/);

  const callback = (query: string, cookie = `gf_linked_role=${stateValue}`) =>
    app.request(`https://api.genshinflex.com/discord/linked-role/callback?${query}`, { headers: { Cookie: cookie } }, env);
  assert.equal((await callback(`code=c&state=чужой`)).status, 400);
  assert.equal((await callback(`code=c&state=${stateValue}`, '')).status, 400);
  assert.equal(received, undefined);
  const ok = await callback(`code=c&state=${stateValue}`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /@traveler/);
  assert.deepEqual(received, { code: 'c', redirectUri: 'https://api.genshinflex.com/discord/linked-role/callback' });
  const cancelled = await callback('error=access_denied');
  assert.match(await cancelled.text(), /отменено/);

  const failing = createApp({ discordRoleLink: async () => { throw new Error('discord'); } });
  const failed = await failing.request(`https://api.genshinflex.com/discord/linked-role/callback?code=c&state=s`, { headers: { Cookie: 'gf_linked_role=s' } }, env);
  assert.equal(failed.status, 502);
  const disabled = await app.request('https://api.genshinflex.com/discord/linked-role', {}, { SITE_ORIGINS: '' } as Env);
  assert.equal(disabled.status, 503);
});

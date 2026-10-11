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
const otherUser = '33333333-3333-4333-8333-333333333333';
const discordId = '398436774873006080';
const state: RoleState = { discord_id: discordId, user_id: userId, nickname: 'traveler', points: 42, in_guild: true };

type Row = {
  discord_id: string; user_id: string | null; token: string; metadata: unknown;
  synced_at: string | null; checked_at: string | null; lease_owner: string | null; lease_until: string | null;
};
const row = (extra: Partial<Row> & { token: string }): Row => ({
  discord_id: discordId, user_id: userId, metadata: null, synced_at: null, checked_at: null,
  lease_owner: null, lease_until: null, ...extra,
});

// База в памяти: discord_role_connections, RPC claim/lease/state и условные update/delete по eq
function fakeDb(rows: Row[], states: RoleState[], options: { stateError?: Error; onState?: () => void } = {}) {
  const table = new Map(rows.map((item) => [item.discord_id, { ...item }]));
  const log: { op: string; filters: Record<string, unknown>; value?: Record<string, unknown> }[] = [];
  const free = (item: Row) => !item.lease_until || Date.parse(item.lease_until) < Date.now();
  const rpc = async (name: string, args: Record<string, any>) => {
    if (name === 'discord_role_state') {
      options.onState?.();
      if (options.stateError) return { data: null, error: options.stateError };
      return { data: states.filter((item) => args.p_discord_ids.includes(item.discord_id)), error: null };
    }
    if (name === 'discord_role_claim') {
      const item = [...table.values()]
        .filter((entry) => (!entry.checked_at || Date.parse(entry.checked_at) < Date.now() - 600_000) && free(entry))
        .sort((a, b) => (a.checked_at ?? '').localeCompare(b.checked_at ?? ''))[0];
      if (!item) return { data: [], error: null };
      Object.assign(item, { lease_owner: args.p_owner, lease_until: new Date(Date.now() + 120_000).toISOString() });
      return { data: [{ ...item }], error: null };
    }
    if (name === 'discord_role_lease') {
      const existing = table.get(args.p_discord_id);
      const lease = { token: args.p_token, metadata: null, synced_at: null, checked_at: null,
        lease_owner: args.p_owner, lease_until: new Date(Date.now() + 120_000).toISOString() };
      if (!existing) table.set(args.p_discord_id, { discord_id: args.p_discord_id, user_id: null, ...lease });
      else if (free(existing)) Object.assign(existing, lease);
      else return { data: false, error: null };
      return { data: true, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  const from = (name: string) => {
    assert.equal(name, 'discord_role_connections');
    const filters: Record<string, unknown> = {};
    let op = 'select';
    let value: Record<string, unknown> | undefined;
    const run = () => {
      const matches = [...table.values()].filter((item) =>
        Object.entries(filters).every(([key, expected]) => (item as any)[key] === expected));
      log.push({ op, filters: { ...filters }, value });
      for (const item of matches) {
        if (op === 'update') Object.assign(item, value);
        if (op === 'delete') table.delete(item.discord_id);
      }
      return matches;
    };
    const chain: any = {
      update: (next: Record<string, unknown>) => { op = 'update'; value = next; return chain; },
      delete: () => { op = 'delete'; return chain; },
      eq: (key: string, expected: unknown) => { filters[key] = expected; return chain; },
      select: () => chain,
      maybeSingle: async () => { const matches = run(); return { data: matches[0] ? { discord_id: matches[0].discord_id } : null, error: null }; },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve().then(() => { run(); return { error: null }; }).then(resolve),
    };
    return chain;
  };
  return { client: { from, rpc } as any, table, log };
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
const oauth = (put: (call: Call) => Response = () => json({})) => fakeFetch({
  '/oauth2/token': tokenResponse,
  '/users/@me/applications/': put,
  '/users/@me': () => json({ id: discordId }),
});
const sealed = (extra: { a?: string; r?: string; e?: number } = {}) =>
  encryptTokens('secret', { a: 'access', r: 'refresh', e: Date.now() + 86_400_000, ...extra });
const puts = (calls: Call[]) => calls.filter((call) => call.method === 'PUT');
const writes = (log: { op: string }[]) => log.filter((entry) => entry.op !== 'select');

test('токены шифруются и не читаются другим секретом', async () => {
  const value = await encryptTokens('secret', { a: 'access', r: 'refresh', e: 123 });
  assert.ok(!value.includes('access'));
  assert.deepEqual(await decryptTokens('secret', value), { a: 'access', r: 'refresh', e: 123 });
  await assert.rejects(decryptTokens('другой', value));
});

test('ссылка авторизации просит role_connections.write', () => {
  const url = new URL(authorizeUrl(config.applicationId, 'https://api.genshinflex.com/discord/linked-role/callback', 'state-1'));
  assert.equal(url.searchParams.get('scope'), 'identify role_connections.write');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.deepEqual(metadataOf(state), { linked: '1', rating: '42', guild: '1', username: 'traveler' });
});

test('callback берёт аренду, читает состояние под ней, отправляет метаданные и снимает аренду', async () => {
  let leasedWhenRead = false;
  const db = fakeDb([], [state], { onState: () => { leasedWhenRead = !!db.table.get(discordId)?.lease_owner; } });
  const { impl, calls } = oauth();
  assert.deepEqual(await completeLink(db.client, config, 'code-1', 'https://api.example/cb', impl), { status: 'linked', nickname: 'traveler' });
  assert.ok(leasedWhenRead);
  assert.deepEqual(JSON.parse(puts(calls)[0].body), {
    platform_name: 'GenshinFlex', platform_username: 'traveler', metadata: { linked: '1', rating: '42', guild: '1' },
  });
  const saved = db.table.get(discordId)!;
  assert.equal(saved.user_id, userId);
  assert.deepEqual(saved.metadata, metadataOf(state));
  assert.equal(saved.lease_owner, null);
  assert.equal((await decryptTokens('secret', saved.token)).r, 'new-refresh');
  assert.ok(writes(db.log).every((entry) => 'lease_owner' in entry.filters));
});

test('ошибка PUT в callback оставляет запись без аренды для cron', async () => {
  const db = fakeDb([], [state]);
  const { impl } = oauth(() => json({}, 500));
  await assert.rejects(completeLink(db.client, config, 'code', 'https://api.example/cb', impl));
  const saved = db.table.get(discordId)!;
  assert.equal(saved.user_id, userId);
  assert.equal(saved.metadata, null);
  assert.equal(saved.lease_owner, null);
  assert.equal(saved.checked_at, null);
});

test('callback без аккаунта под арендой сбрасывает метаданные и удаляет запись', async () => {
  const token = await sealed();
  const db = fakeDb([row({ token, metadata: metadataOf(state) })], []);
  const { impl, calls } = oauth();
  assert.deepEqual(await completeLink(db.client, config, 'code', 'https://api.example/cb', impl), { status: 'no_account' });
  assert.deepEqual(JSON.parse(puts(calls)[0].body).metadata, { linked: '0', rating: '0', guild: '0' });
  assert.equal(db.table.size, 0);
});

test('занятая аренда прерывает callback до PUT', async () => {
  const token = await sealed();
  const db = fakeDb([row({ token, lease_owner: otherUser, lease_until: new Date(Date.now() + 60_000).toISOString() })], [state]);
  const { impl, calls } = oauth();
  await assert.rejects(completeLink(db.client, config, 'code', 'https://api.example/cb', impl), /обрабатывается/);
  assert.equal(puts(calls).length, 0);
  assert.equal(db.table.get(discordId)!.token, token);
});

test('cron захватывает по одной записи и снимает аренду после каждой', async () => {
  const token = await sealed();
  const second = { ...state, discord_id: '398436774873006081' };
  const db = fakeDb([
    row({ token, metadata: { ...metadataOf(state), rating: '1' } }),
    row({ token, discord_id: second.discord_id, metadata: { ...metadataOf(second), rating: '1' } }),
  ], [state, second]);
  const { impl, calls } = fakeFetch({ '/role-connection': () => json({}) });
  assert.deepEqual(await syncRoleConnections(db.client, config, impl), { checked: 2, pushed: 2, removed: 0 });
  assert.equal(puts(calls).length, 2);
  for (const item of db.table.values()) {
    assert.equal(item.lease_owner, null);
    assert.ok(item.checked_at);
    assert.equal(item.metadata && (item.metadata as { rating: string }).rating, '42');
  }
});

test('cron не обращается к Discord при свежих совпадающих метаданных и подтверждает доступ раз в сутки', async () => {
  const token = await sealed();
  const fresh = fakeDb([row({ token, metadata: metadataOf(state), synced_at: new Date().toISOString() })], [state]);
  const quiet = fakeFetch({});
  assert.deepEqual(await syncRoleConnections(fresh.client, config, quiet.impl), { checked: 1, pushed: 0, removed: 0 });
  assert.equal(quiet.calls.length, 0);
  assert.ok(fresh.table.get(discordId)!.checked_at);

  const stale = fakeDb([row({ token, metadata: metadataOf(state), synced_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })], [state]);
  const confirm = fakeFetch({ '/role-connection': () => json({}) });
  assert.deepEqual(await syncRoleConnections(stale.client, config, confirm.impl), { checked: 1, pushed: 1, removed: 0 });
});

test('cron обновляет истекающий токен и сохраняет его до PUT', async () => {
  const token = await sealed({ e: Date.now() + 30_000 });
  const db = fakeDb([row({ token })], [state]);
  let savedBeforePut = false;
  const { impl, calls } = fakeFetch({
    '/oauth2/token': tokenResponse,
    '/role-connection': () => { savedBeforePut = db.table.get(discordId)!.token !== token; return json({}); },
  });
  assert.deepEqual(await syncRoleConnections(db.client, config, impl), { checked: 1, pushed: 1, removed: 0 });
  assert.match(calls[0].body, /grant_type=refresh_token&refresh_token=refresh/);
  assert.equal(calls[1].auth, 'Bearer new-access');
  assert.ok(savedBeforePut);
});

test('401 на PUT вызывает refresh и повторную отправку', async () => {
  const token = await sealed();
  const db = fakeDb([row({ token })], [state]);
  let attempt = 0;
  const { impl } = fakeFetch({
    '/oauth2/token': tokenResponse,
    '/role-connection': () => (++attempt === 1 ? json({}, 401) : json({})),
  });
  assert.deepEqual(await syncRoleConnections(db.client, config, impl), { checked: 1, pushed: 1, removed: 0 });
  assert.equal(attempt, 2);
  assert.ok(db.table.has(discordId));
});

test('cron сбрасывает роли отвязанного Discord, удалённого аккаунта и Discord другого владельца', async () => {
  for (const [rowExtra, states] of [
    [{}, []],
    [{ user_id: null }, [state]],
    [{}, [{ ...state, user_id: otherUser }]],
  ] as [Partial<Row>, RoleState[]][]) {
    const db = fakeDb([row({ token: await sealed(), metadata: metadataOf(state), ...rowExtra })], states);
    const { impl, calls } = fakeFetch({ '/role-connection': () => json({}) });
    assert.deepEqual(await syncRoleConnections(db.client, config, impl), { checked: 1, pushed: 0, removed: 1 });
    assert.deepEqual(JSON.parse(calls[0].body).metadata, { linked: '0', rating: '0', guild: '0' });
    assert.equal(db.table.size, 0);
  }
});

test('отозванный доступ удаляет запись, 429 останавливает цикл и снимает аренду', async () => {
  const token = await sealed();
  const revoked = fakeDb([row({ token })], [state]);
  const denied = fakeFetch({ '/role-connection': () => json({}, 401), '/oauth2/token': () => json({}, 400) });
  assert.deepEqual(await syncRoleConnections(revoked.client, config, denied.impl), { checked: 1, pushed: 0, removed: 1 });

  const limited = fakeDb([row({ token }), row({ token, discord_id: '398436774873006081' })], [state]);
  const slow = fakeFetch({ '/role-connection': () => json({ retry_after: 10 }, 429) });
  assert.deepEqual(await syncRoleConnections(limited.client, config, slow.impl), { checked: 1, pushed: 0, removed: 0 });
  assert.equal(slow.calls.length, 1);
  assert.ok([...limited.table.values()].every((item) => item.lease_owner === null));
});

test('ошибка PUT отмечает проверку и оставляет запись; ошибка состояния тоже снимает аренду', async () => {
  const token = await sealed();
  const db = fakeDb([row({ token })], [state]);
  const { impl } = fakeFetch({ '/role-connection': () => json({}, 500) });
  assert.deepEqual(await syncRoleConnections(db.client, config, impl), { checked: 1, pushed: 0, removed: 0 });
  const kept = db.table.get(discordId)!;
  assert.ok(kept.checked_at);
  assert.equal(kept.lease_owner, null);

  const broken = fakeDb([row({ token })], [state], { stateError: new Error('rpc') });
  assert.deepEqual(await syncRoleConnections(broken.client, config, fakeFetch({}).impl), { checked: 1, pushed: 0, removed: 0 });
  assert.equal(broken.table.get(discordId)!.lease_owner, null);
  assert.ok(broken.table.get(discordId)!.checked_at);
});

test('потерянная аренда не даёт cron обращаться к Discord и менять запись', async () => {
  const token = await sealed({ e: Date.now() + 30_000 });
  const realNow = Date.now;
  // Уже после захвата другой владелец перехватил запись, а наша аренда почти истекла: продлить её не выйдет
  const db = fakeDb([row({ token })], [state], { onState: () => {
    db.table.get(discordId)!.lease_owner = otherUser;
    Date.now = () => realNow() + 100_000;
  } });
  const { impl, calls } = fakeFetch({ '/oauth2/token': tokenResponse, '/role-connection': () => json({}) });
  try {
    await syncRoleConnections(db.client, config, impl, 1);
  } finally {
    Date.now = realNow;
  }
  assert.equal(calls.length, 0);
  assert.equal(db.table.get(discordId)!.token, token);
  assert.equal(db.table.get(discordId)!.lease_owner, otherUser);
});

test('бюджет времени останавливает цикл', async () => {
  const token = await sealed();
  const db = fakeDb([row({ token })], [state]);
  const { impl } = fakeFetch({ '/role-connection': () => json({}) });
  assert.equal((await syncRoleConnections(db.client, config, impl, 25, -1)).checked, 0);
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

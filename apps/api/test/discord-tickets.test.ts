import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/index.ts';
import { handleInteraction } from '../src/lib/discord.ts';
import type { DiscordInteraction } from '../src/lib/discord.ts';
import type { TicketDeps } from '../src/lib/discord-tickets.ts';
import type { Env } from '../src/lib/env.ts';

const author = '398436774873006080';
const staff = '1558811008833818745';
const channel = '1558832985246146560';
const thread = '1558832985246146561';
type Row = {
  id: number; discord_id: string; thread_id: string | null; interaction_id: string | null;
  status: string; created_at: string; updated_at: string; closed_at: string | null; close_token?: string | null;
};
type Options = { archived?: boolean; attach?: boolean; patchFails?: boolean; messageFails?: boolean };

function fixture(initial: Row[] = [], options: Options = {}) {
  const rows = [...initial];
  const calls: { url: string; method: string; body: any; auth: string; signal?: AbortSignal }[] = [];
  const rpcCalls: { name: string; params: Record<string, any> }[] = [];
  const tasks: Promise<unknown>[] = [];
  const interactions = new Set(rows.map((item) => item.interaction_id).filter((id): id is string => !!id));
  let nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;
  const client = {
    async rpc(name: string, params: Record<string, any>) {
      rpcCalls.push({ name, params });
      let data: any;
      const now = new Date().toISOString();
      if (name === 'discord_ticket_open') {
        if (interactions.has(params.p_interaction_id)) {
          data = { status: 'duplicate' };
        } else {
          interactions.add(params.p_interaction_id);
          for (const row of rows) {
            if (row.discord_id !== params.p_discord_id) continue;
            if (row.status === 'open' && !row.thread_id
              && Date.now() - Date.parse(row.created_at) > 120_000) {
              row.status = 'closed';
              row.closed_at = now;
            }
            if (row.status === 'closing' && Date.now() - Date.parse(row.updated_at) > 120_000) {
              row.status = 'open';
            }
          }
          const active = rows.find((row) => row.discord_id === params.p_discord_id
            && (row.status === 'open' || row.status === 'closing'));
          if (active) data = active.thread_id
            ? { status: 'exists', id: active.id, thread_id: active.thread_id }
            : { status: 'creating' };
          else if (rows.filter((row) => row.discord_id === params.p_discord_id
            && Date.now() - Date.parse(row.created_at) < 86_400_000).length >= 3) {
            data = { status: 'limit' };
          } else {
            const row: Row = { id: nextId++, discord_id: params.p_discord_id, interaction_id: params.p_interaction_id,
              thread_id: null, status: 'open', created_at: now, updated_at: now, closed_at: null };
            rows.push(row);
            data = { status: 'created', id: row.id };
          }
        }
      } else if (name === 'discord_ticket_attach') {
        const row = rows.find((item) => item.id === params.p_id && item.status === 'open' && !item.thread_id);
        data = !!row && options.attach !== false;
        if (data) { row!.thread_id = params.p_thread_id; row!.updated_at = now; }
      } else if (name === 'discord_ticket_abandon') {
        const index = rows.findIndex((row) => row.id === params.p_id && row.status === 'open');
        if (index >= 0) rows.splice(index, 1);
      } else if (name === 'discord_ticket_close_begin') {
        const row = rows.find((item) => item.thread_id === params.p_thread_id);
        if (!row) data = { status: 'missing' };
        else if (row.status === 'closed') data = { status: 'closed' };
        else if (row.status === 'closing' && Date.now() - Date.parse(row.updated_at) < 120_000) {
          data = { status: 'closing' };
        } else {
          row.status = 'closing';
          row.updated_at = now;
          row.close_token = params.p_token;
          data = { status: 'claimed', id: row.id, discord_id: row.discord_id };
        }
      } else if (name === 'discord_ticket_close_finish') {
        const row = rows.find((item) => item.id === params.p_id && item.status === 'closing'
          && item.close_token === params.p_token);
        if (row) {
          row.status = params.p_ok ? 'closed' : 'open';
          row.updated_at = now;
          if (params.p_ok) row.closed_at = now;
        }
      } else {
        throw new Error(`Неизвестный RPC: ${name}`);
      }
      return { data, error: null };
    },
  } as unknown as ReturnType<TicketDeps['client']>;
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body, auth: new Headers(init.headers).get('Authorization') || '',
      signal: init.signal || undefined });
    if (method === 'GET') return new Response(JSON.stringify({ thread_metadata: { archived: options.archived } }));
    if (method === 'POST' && url.endsWith('/threads')) return new Response(JSON.stringify({ id: thread }));
    if (method === 'POST' && url.endsWith(`/channels/${thread}/messages`) && options.messageFails) {
      return new Response('{}', { status: 503 });
    }
    if (method === 'PATCH' && url.endsWith(`/channels/${thread}`) && options.patchFails) {
      return new Response('{}', { status: 503 });
    }
    return new Response('{}');
  }) as typeof fetch;
  const deps: TicketDeps = {
    client: () => client, fetchImpl, waitUntil: (task) => { tasks.push(task); },
    findLinkedProfile: async () => ({ nickname: 'traveler', is_public: true }),
    channelId: channel, botToken: 'test-token', applicationId: '1553420351973761115',
    supportRoleIds: [staff],
  };
  const interactionDeps = { loadBuilds: async () => [], site: 'https://genshinflex.com', ticket: deps };
  const flush = async () => { await Promise.all(tasks.splice(0)); };
  return { rows, calls, rpcCalls, deps, interactionDeps, flush };
}

const modal = (user = author, id = 'interaction-1'): DiscordInteraction => ({
  type: 5, id, token: 'interaction-token', member: { user: { id: user } },
  data: { custom_id: 'ticket:create', components: [
    { components: [{ custom_id: 'subject', value: 'Помогите с аккаунтом' }] },
    { components: [{ custom_id: 'details', value: 'Не получается войти в аккаунт' }] },
  ] },
});
const row = (extra: Partial<Row> = {}): Row => ({
  id: 7, discord_id: author, thread_id: thread, interaction_id: null, status: 'open',
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), closed_at: null, ...extra,
});
const reply = (calls: ReturnType<typeof fixture>['calls']) =>
  calls.find((call) => call.url.endsWith('/messages/@original'))?.body.content;
const close = (user = author, id = 7, member: Record<string, unknown> = {}) => ({
  type: 3, token: 'close-token', data: { custom_id: `ticket:close:${id}` }, channel_id: thread,
  member: { user: { id: user }, ...member },
});

test('кнопка и команда открывают форму', async () => {
  const { interactionDeps } = fixture();
  for (const interaction of [
    { type: 3, data: { custom_id: 'ticket:open' }, member: { user: { id: author } } },
    { type: 2, data: { name: 'тикет' }, member: { user: { id: author } } },
  ]) {
    const result = await handleInteraction(interaction, interactionDeps);
    assert.equal(result.type, 9);
    assert.equal(result.data.custom_id, 'ticket:create');
    assert.deepEqual(result.data.components?.map((item) => item.components[0].custom_id), ['subject', 'details']);
  }
});

test('форма откладывает ответ и создаёт приватную ветку с участниками и аккаунтом', async () => {
  const fixtureData = fixture();
  const { calls, rows, interactionDeps, flush } = fixtureData;
  assert.deepEqual(await handleInteraction(modal(), interactionDeps), { type: 5, data: { flags: 64 } });
  await flush();
  assert.equal(rows[0].thread_id, thread);
  const created = calls.find((call) => call.url.endsWith('/threads'))!;
  assert.deepEqual(created.body, {
    name: 'тикет-0001 · Помогите с аккаунтом', type: 12, invitable: false, auto_archive_duration: 10080,
  });
  assert.ok(calls.some((call) => call.url.endsWith(`/thread-members/${author}`) && call.method === 'PUT'));
  const message = calls.find((call) => call.url.endsWith(`/channels/${thread}/messages`))!.body;
  assert.equal(message.content, `<@${author}> <@&${staff}>`);
  assert.deepEqual(message.allowed_mentions, { users: [author], roles: [staff] });
  assert.match(message.embeds[0].fields[0].value, /\[@traveler\]\(https:\/\/genshinflex.com\/u\/traveler\/\)/);
  assert.equal(message.components[0].components[0].custom_id, 'ticket:close:1');
  assert.equal(reply(calls), `Тикет создан: <#${thread}>`);
  assert.ok(calls.every((call) => call.auth === 'Bot test-token' && call.signal));
  assert.equal(fixtureData.rpcCalls.filter((call) => call.name === 'discord_ticket_attach').length, 1);
});

test('существующий тикет и суточный лимит дают отказ', async () => {
  const existing = fixture([row()]);
  assert.equal((await handleInteraction(modal(), existing.interactionDeps)).type, 5);
  await existing.flush();
  assert.equal(reply(existing.calls), `У вас уже есть открытый тикет: <#${thread}>`);
  assert.equal(existing.calls.filter((call) => call.url.endsWith('/threads')).length, 0);

  const limited = fixture([row({ id: 1, status: 'closed' }), row({ id: 2, status: 'closed' }),
    row({ id: 3, status: 'closed' })]);
  await handleInteraction(modal(), limited.interactionDeps);
  await limited.flush();
  assert.equal(reply(limited.calls), 'Слишком много тикетов за сутки, попробуйте завтра');
});

test('архивированная ветка освобождает место для нового тикета', async () => {
  const data = fixture([row({ id: 7 })], { archived: true });
  await handleInteraction(modal(), data.interactionDeps);
  await data.flush();
  assert.equal(data.rows[0].status, 'closed');
  assert.equal(data.rows[1].thread_id, thread);
  assert.equal(reply(data.calls), `Тикет создан: <#${thread}>`);
});

test('повтор взаимодействия ничего не делает', async () => {
  const data = fixture([row({ interaction_id: 'interaction-1' })]);
  await handleInteraction(modal(), data.interactionDeps);
  await data.flush();
  assert.equal(data.calls.length, 0);
  assert.deepEqual(data.rpcCalls.map((call) => call.name), ['discord_ticket_open']);
});

test('создающийся тикет блокирует второй запрос', async () => {
  const data = fixture([row({ thread_id: null })]);
  await handleInteraction(modal(), data.interactionDeps);
  await data.flush();
  assert.equal(reply(data.calls), 'Тикет уже создаётся, подождите минуту');
  assert.equal(data.calls.filter((call) => call.url.endsWith('/threads')).length, 0);
});

test('если запись уже закрыта до привязки, ветка архивируется', async () => {
  const data = fixture([], { attach: false });
  await handleInteraction(modal(), data.interactionDeps);
  await data.flush();
  assert.equal(reply(data.calls), 'Не удалось создать тикет, попробуйте ещё раз');
  assert.ok(data.calls.some((call) => call.method === 'PATCH' && call.url.endsWith(`/channels/${thread}`)
    && call.body.archived && call.body.locked));
});

test('автор, поддержка и право управления ветками позволяют закрыть тикет', async () => {
  for (const member of [
    { user: { id: author } },
    { user: { id: '398436774873006081' }, roles: [staff] },
    { user: { id: '398436774873006081' }, permissions: String(1n << 34n) },
  ]) {
    const data = fixture([row()]);
    const result = await handleInteraction({
      type: 3, token: 'close-token', data: { custom_id: 'ticket:close:7' }, channel_id: thread, member,
    }, data.interactionDeps);
    assert.deepEqual(result, { type: 5, data: { flags: 64 } });
    assert.equal(data.rpcCalls.length, 0);
    await data.flush();
    assert.equal(data.rows[0].status, 'closed');
    assert.equal(reply(data.calls), 'Тикет закрыт');
    const message = data.calls.find((call) => call.method === 'POST'
      && call.url.endsWith(`/channels/${thread}/messages`))!.body;
    assert.deepEqual(message.allowed_mentions, { parse: [] });
    assert.ok(data.calls.some((call) => call.method === 'PATCH' && call.url.endsWith(`/channels/${thread}`)
      && call.body.archived && call.body.locked));
  }
});

test('два закрытия публикуют сообщение и архивируют ветку только один раз', async () => {
  const data = fixture([row()]);
  assert.deepEqual(await handleInteraction(close(), data.interactionDeps), { type: 5, data: { flags: 64 } });
  assert.deepEqual(await handleInteraction(close(), data.interactionDeps), { type: 5, data: { flags: 64 } });
  await data.flush();
  assert.equal(data.calls.filter((call) => call.method === 'POST'
    && call.url.endsWith(`/channels/${thread}/messages`)).length, 1);
  assert.equal(data.calls.filter((call) => call.method === 'PATCH'
    && call.url.endsWith(`/channels/${thread}`)).length, 1);
  assert.deepEqual(data.calls.filter((call) => call.url.endsWith('/messages/@original'))
    .map((call) => call.body.content).sort(), ['Тикет закрыт', 'Тикет уже закрыт'].sort());
});

test('ошибка архивации возвращает тикет в открытое состояние', async () => {
  const data = fixture([row()], { patchFails: true });
  await handleInteraction(close(), data.interactionDeps);
  await data.flush();
  assert.equal(data.rows[0].status, 'open');
  assert.equal(reply(data.calls), 'Не удалось закрыть тикет, попробуйте ещё раз');
  assert.ok(data.rpcCalls.some((call) => call.name === 'discord_ticket_close_finish' && call.params.p_ok === false));
});

test('чужой участник освобождает заявку на закрытие', async () => {
  const data = fixture([row()]);
  await handleInteraction(close('398436774873006081'), data.interactionDeps);
  await data.flush();
  assert.equal(data.rows[0].status, 'open');
  assert.equal(reply(data.calls), 'Закрыть тикет может автор или поддержка');
  assert.ok(data.rpcCalls.some((call) => call.name === 'discord_ticket_close_finish' && call.params.p_ok === false));
  assert.equal(data.calls.filter((call) => call.url.endsWith(`/channels/${thread}/messages`)).length, 0);
});

test('закрытый и отсутствующий тикеты дают отдельные ответы', async () => {
  const closed = fixture([row({ status: 'closed' })]);
  await handleInteraction(close(), closed.interactionDeps);
  await closed.flush();
  assert.equal(reply(closed.calls), 'Тикет уже закрыт');
  const missing = fixture([row()]);
  await handleInteraction(close(author, 8), missing.interactionDeps);
  await missing.flush();
  assert.equal(reply(missing.calls), 'Тикет не найден');
  assert.equal(missing.rows[0].status, 'open');
});

test('старый подписанный запрос отклоняется', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const env = { SITE_ORIGINS: '', DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey('raw', pair.publicKey)) } as Env;
  const timestamp = String(Math.floor(Date.now() / 1000) - 301);
  const body = '{"type":1}';
  const signature = hex(await crypto.subtle.sign('Ed25519', pair.privateKey,
    new TextEncoder().encode(timestamp + body)));
  const response = await createApp().request('/discord/interactions', {
    method: 'POST', body,
    headers: { 'X-Signature-Timestamp': timestamp, 'X-Signature-Ed25519': signature },
  }, env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Неверная подпись' });
});

test('без настроек тикеты недоступны', async () => {
  const data = fixture();
  data.deps.channelId = undefined;
  assert.deepEqual(await handleInteraction({
    type: 2, data: { name: 'тикет' }, member: { user: { id: author } },
  }, data.interactionDeps), { type: 4, data: { content: 'Тикеты временно недоступны', flags: 64 } });
});

test('повтор той же формы после отказа не создаёт тикет', async () => {
  const data = fixture([row()]);
  await handleInteraction(modal(), data.interactionDeps);
  await data.flush();
  assert.match(reply(data.calls), /уже есть открытый тикет/);
  data.rows[0].status = 'closed';
  const calls = data.calls.length;
  await handleInteraction(modal(), data.interactionDeps);
  await data.flush();
  assert.equal(data.rows.length, 1);
  assert.equal(data.calls.length, calls);
});

test('ветка записывается сразу: при сбое первого сообщения тикет остаётся, пока ветку не удалось убрать', async () => {
  const stuck = fixture([], { messageFails: true, patchFails: true });
  await handleInteraction(modal(), stuck.interactionDeps);
  await stuck.flush();
  assert.equal(stuck.rows.length, 1);
  assert.equal(stuck.rows[0].thread_id, thread);
  assert.match(reply(stuck.calls), /Не удалось создать тикет/);

  const cleaned = fixture([], { messageFails: true });
  await handleInteraction(modal(), cleaned.interactionDeps);
  await cleaned.flush();
  assert.equal(cleaned.rows.length, 0);
});

test('запоздалое завершение чужой операции закрытия ничего не меняет', async () => {
  const data = fixture([row({ status: 'closing', close_token: 'current', updated_at: new Date().toISOString() })]);
  await data.deps.client().rpc('discord_ticket_close_finish', { p_id: 7, p_ok: false, p_token: 'stale' });
  assert.equal(data.rows[0].status, 'closing');
});

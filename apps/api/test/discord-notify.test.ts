import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverDiscordNotifications } from '../src/lib/discord-notify.ts';
import type { DiscordNotification } from '../src/lib/discord-notify.ts';

const item: DiscordNotification = {
  id: 1,
  discord_id: 'user',
  kind: 'reply',
  actor: { name: 'Анна' },
  thread_id: 42,
  thread_title: 'Тема',
  post_id: 7,
  snippet: '  Привет   друг  ',
};

const client = (items: DiscordNotification[], acks: number[][] = []) => ({
  rpc: async (name: string, args: { p_limit?: number; p_ids?: number[] }) => {
    if (name === 'discord_notifications_ack') {
      acks.push(args.p_ids ?? []);
      return { data: null, error: null };
    }
    assert.equal(name, 'discord_notifications_claim');
    assert.deepEqual(args, { p_limit: 50 });
    return { data: items, error: null };
  },
}) as unknown as Parameters<typeof deliverDiscordNotifications>[0];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('delivers embeds and buttons while opening one DM per user', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const acks: number[][] = [];
  const send: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, body });
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bot token');
    assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.ok(init?.signal);
    return url.endsWith('/users/@me/channels') ? json({ id: 'channel' }, 201) : json({ id: 'message' });
  };
  assert.deepEqual(await deliverDiscordNotifications(client([item, { ...item, id: 2 }], acks), 'token', send), { claimed: 2, sent: 2 });
  assert.deepEqual(acks, [[1, 2]]);
  assert.deepEqual(requests.map(({ url }) => url), [
    'https://discord.com/api/v10/users/@me/channels',
    'https://discord.com/api/v10/channels/channel/messages',
    'https://discord.com/api/v10/channels/channel/messages',
  ]);
  assert.deepEqual(requests[0].body, { recipient_id: 'user' });
  assert.deepEqual(requests[1].body, {
    embeds: [{ title: 'Ответ от Анна в теме «Тема»', description: 'Привет друг', url: 'https://genshinflex.com/forum/t/42/#p7', color: 0xD3BC8E, footer: { text: 'GenshinFlex' } }],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Открыть на GenshinFlex', url: 'https://genshinflex.com/forum/t/42/#p7' }] }],
    allowed_mentions: { parse: [] },
  });
});

test('50007 does not stop later notifications', async () => {
  const calls: string[] = [];
  const acks: number[][] = [];
  const send: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { recipient_id?: string };
    calls.push(String(input));
    if (body.recipient_id === 'closed') return json({ code: 50007 }, 403);
    if (String(input).endsWith('/users/@me/channels')) return json({ id: 'channel' }, 201);
    return json({ id: 'message' });
  };
  assert.deepEqual(await deliverDiscordNotifications(client([{ ...item, discord_id: 'closed' }, { ...item, id: 2 }], acks), 'token', send), { claimed: 2, sent: 1 });
  assert.deepEqual(acks, [[1, 2]]);
  assert.equal(calls.length, 3);
});

test('retries a short 429 once', async () => {
  let calls = 0;
  const acks: number[][] = [];
  const send: typeof fetch = async (input) => {
    calls++;
    if (calls === 1) return json({ retry_after: 0 }, 429);
    return String(input).endsWith('/users/@me/channels') ? json({ id: 'channel' }, 201) : json({ id: 'message' });
  };
  assert.deepEqual(await deliverDiscordNotifications(client([item], acks), 'token', send), { claimed: 1, sent: 1 });
  assert.deepEqual(acks, [[1]]);
  assert.equal(calls, 3);
});

test('stops after a long 429', async () => {
  const acks: number[][] = [];
  let calls = 0;
  const send: typeof fetch = async (input) => {
    calls++;
    if (calls === 3) return json({ retry_after: 6 }, 429);
    return String(input).endsWith('/users/@me/channels') ? json({ id: 'channel' }, 201) : json({ id: 'message' });
  };
  assert.deepEqual(await deliverDiscordNotifications(client([item, { ...item, id: 2, discord_id: 'limited' }, { ...item, id: 3, discord_id: 'later' }], acks), 'token', send), { claimed: 3, sent: 1 });
  assert.equal(calls, 3);
  assert.deepEqual(acks, [[1]]);
});

test('stops without ack when Discord rejects the bot token while opening a DM', async () => {
  const acks: number[][] = [];
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    return json({ message: '401: Unauthorized' }, 401);
  };
  assert.deepEqual(await deliverDiscordNotifications(client([item, { ...item, id: 2 }], acks), 'token', send),
    { claimed: 2, sent: 0 });
  assert.equal(calls, 1);
  assert.deepEqual(acks, []);
});

test('acks earlier sends but stops without ack for a send rejected with 401', async () => {
  const acks: number[][] = [];
  let messages = 0;
  const send: typeof fetch = async (input) => {
    if (String(input).endsWith('/users/@me/channels')) return json({ id: 'channel' }, 201);
    return ++messages === 1 ? json({ id: 'message' }) : json({ message: 'Unauthorized' }, 401);
  };
  assert.deepEqual(await deliverDiscordNotifications(client([item, { ...item, id: 2 }, { ...item, id: 3 }], acks), 'token', send),
    { claimed: 3, sent: 1 });
  assert.equal(messages, 2);
  assert.deepEqual(acks, [[1]]);
});

test('without a token, skips the claim and HTTP requests', async () => {
  const unused = { rpc: async () => { throw new Error('RPC called'); } } as unknown as Parameters<typeof deliverDiscordNotifications>[0];
  const send: typeof fetch = async () => { throw new Error('HTTP called'); };
  assert.deepEqual(await deliverDiscordNotifications(unused, '', send), { claimed: 0, sent: 0 });
});

test('acks permanent Discord failures but retries temporary ones', async () => {
  const acks: number[][] = [];
  const send: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as { recipient_id?: string };
    if (body.recipient_id === 'closed') return json({ code: 50007 }, 403);
    if (body.recipient_id === 'server') return json({ message: 'unavailable' }, 500);
    if (body.recipient_id === 'network') throw new Error('network');
    if (url.endsWith('/users/@me/channels')) return json({ id: body.recipient_id === 'send-closed' ? 'send-closed' : 'send-server' }, 201);
    if (url.includes('/send-closed/')) return json({ code: 50278 }, 403);
    return json({ message: 'unavailable' }, 500);
  };
  const items = [
    { ...item, discord_id: 'closed' },
    { ...item, id: 2, discord_id: 'server' },
    { ...item, id: 3, discord_id: 'network' },
    { ...item, id: 4, discord_id: 'send-closed' },
    { ...item, id: 5, discord_id: 'send-server' },
  ];
  assert.deepEqual(await deliverDiscordNotifications(client(items, acks), 'token', send), { claimed: 5, sent: 0 });
  assert.deepEqual(acks, [[1, 4]]);
});

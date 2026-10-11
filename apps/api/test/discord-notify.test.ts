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

const client = (items: DiscordNotification[]) => ({
  rpc: async (name: string, args: { p_limit: number }) => {
    assert.equal(name, 'discord_notifications_claim');
    assert.deepEqual(args, { p_limit: 50 });
    return { data: items, error: null };
  },
}) as unknown as Parameters<typeof deliverDiscordNotifications>[0];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('delivers embeds and buttons while opening one DM per user', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
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
  assert.deepEqual(await deliverDiscordNotifications(client([item, { ...item, id: 2 }]), 'token', send), { claimed: 2, sent: 2 });
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
  const send: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { recipient_id?: string };
    calls.push(String(input));
    if (body.recipient_id === 'closed') return json({ code: 50007 }, 403);
    if (String(input).endsWith('/users/@me/channels')) return json({ id: 'channel' }, 201);
    return json({ id: 'message' });
  };
  assert.deepEqual(await deliverDiscordNotifications(client([{ ...item, discord_id: 'closed' }, { ...item, id: 2 }]), 'token', send), { claimed: 2, sent: 1 });
  assert.equal(calls.length, 3);
});

test('retries a short 429 once', async () => {
  let calls = 0;
  const send: typeof fetch = async (input) => {
    calls++;
    if (calls === 1) return json({ retry_after: 0 }, 429);
    return String(input).endsWith('/users/@me/channels') ? json({ id: 'channel' }, 201) : json({ id: 'message' });
  };
  assert.deepEqual(await deliverDiscordNotifications(client([item]), 'token', send), { claimed: 1, sent: 1 });
  assert.equal(calls, 3);
});

test('stops after a long 429', async () => {
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    return json({ retry_after: 6 }, 429);
  };
  assert.deepEqual(await deliverDiscordNotifications(client([item, { ...item, id: 2 }]), 'token', send), { claimed: 2, sent: 0 });
  assert.equal(calls, 1);
});

test('without a token, skips the claim and HTTP requests', async () => {
  const unused = { rpc: async () => { throw new Error('RPC called'); } } as unknown as Parameters<typeof deliverDiscordNotifications>[0];
  const send: typeof fetch = async () => { throw new Error('HTTP called'); };
  assert.deepEqual(await deliverDiscordNotifications(unused, '', send), { claimed: 0, sent: 0 });
});

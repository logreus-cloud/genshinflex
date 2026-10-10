import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverTelegramNotifications, telegramMessage } from '../src/lib/telegram-notify.ts';
import type { TelegramNotification } from '../src/lib/telegram-notify.ts';

const item: TelegramNotification = {
  id: 1,
  telegram_id: 123,
  kind: 'reply',
  actor: { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Анна', nickname: 'Anna', public: true },
  thread_id: 42,
  thread_title: 'Тема',
  post_id: 7,
  snippet: null,
};

test('telegramMessage formats every notification kind and link', () => {
  const cases = [
    ['reply', 'Ответ от Анна в теме «Тема»', 'https://genshinflex.com/forum/t/42/#p7'],
    ['mention', 'Упоминание от Анна в теме «Тема»', 'https://genshinflex.com/forum/t/42/#p7'],
    ['follow', 'Новый подписчик: Анна', 'https://genshinflex.com/u/Anna/'],
    ['friend_request', 'Заявка в друзья от Анна', 'https://genshinflex.com/friends/'],
    ['friend_accept', 'Анна теперь у вас в друзьях', 'https://genshinflex.com/u/Anna/'],
    ['message', 'Сообщение от Анна', 'https://genshinflex.com/messages/?u=123e4567-e89b-12d3-a456-426614174000'],
  ];
  for (const [kind, heading, href] of cases)
    assert.equal(telegramMessage({ ...item, kind }), `${heading}\n\n<a href="${href}">Открыть на GenshinFlex</a>`);
});

test('telegramMessage escapes user content and handles missing destinations', () => {
  assert.equal(
    telegramMessage({ ...item, actor: { name: '<А & Б>' }, thread_title: '<тема>&', snippet: '  <b>  &   привет  ' }),
    'Ответ от &lt;А &amp; Б&gt; в теме «&lt;тема&gt;&amp;»\n\n&lt;b&gt; &amp; привет\n\n<a href="https://genshinflex.com/forum/t/42/#p7">Открыть на GenshinFlex</a>',
  );
  assert.equal(
    telegramMessage({ ...item, actor: null, thread_id: null, thread_title: null, post_id: null }),
    'Ответ от Удалённый пользователь\n\n<a href="https://genshinflex.com/notifications/">Открыть на GenshinFlex</a>',
  );
  assert.match(
    telegramMessage({ ...item, kind: 'follow', actor: { name: 'А', nickname: 'A&B', public: true } }),
    /href="https:\/\/genshinflex.com\/u\/A%26B\/"/,
  );
  assert.match(
    telegramMessage({ ...item, kind: 'follow', actor: { name: 'А', nickname: 'A', public: false } }),
    /href="https:\/\/genshinflex.com\/notifications\/"/,
  );
  assert.match(telegramMessage({ ...item, snippet: 'a'.repeat(170) }), new RegExp(`^Ответ.*\n\n${'a'.repeat(160)}\n\n<a`));
  assert.match(telegramMessage({ ...item, kind: 'message' }, 'https://site.test/a&b'), /href="https:\/\/site.test\/a&amp;b\/messages\/\?u=123e4567-e89b-12d3-a456-426614174000"/);
  assert.match(telegramMessage({ ...item, kind: 'message', actor: null }), /href="https:\/\/genshinflex.com\/messages\/"/);
  assert.match(
    telegramMessage({ ...item, kind: 'message', actor: { id: 'a&b' } }),
    /href="https:\/\/genshinflex.com\/messages\/\?u=a%26b"/,
  );
});

test('deliverTelegramNotifications continues after Telegram errors', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: { p_limit: number }) => {
      assert.equal(name, 'telegram_notifications_claim');
      assert.deepEqual(args, { p_limit: 50 });
      return { data: [item, ...[2, 3, 4].map((id) => ({ ...item, id, telegram_id: id }))], error: null };
    },
  } as unknown as Parameters<typeof deliverTelegramNotifications>[0];
  const send: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(input), body });
    if (body.chat_id === 2) throw new Error('network');
    if (body.chat_id === 3) return new Response('', { status: 403 });
    return new Response('ok');
  };
  assert.deepEqual(await deliverTelegramNotifications(client, 'token', send), { claimed: 4, sent: 2 });
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url, 'https://api.telegram.org/bottoken/sendMessage');
  assert.deepEqual(requests[0].body, {
    chat_id: 123,
    text: telegramMessage(item),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
});

test('deliverTelegramNotifications skips an empty token and throws on claim errors', async () => {
  const unused = {
    rpc: async () => { throw new Error('RPC called'); },
  } as unknown as Parameters<typeof deliverTelegramNotifications>[0];
  assert.deepEqual(await deliverTelegramNotifications(unused, ''), { claimed: 0, sent: 0 });
  const failed = {
    rpc: async () => ({ data: null, error: new Error('claim failed') }),
  } as unknown as Parameters<typeof deliverTelegramNotifications>[0];
  await assert.rejects(deliverTelegramNotifications(failed, 'token'), /claim failed/);
});

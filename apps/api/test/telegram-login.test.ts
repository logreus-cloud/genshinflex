import assert from 'node:assert/strict';
import { test } from 'node:test';
import { telegramLogin } from '../src/lib/telegram-login.ts';
import { verifyTelegram } from '../src/lib/telegram.ts';

function fakeClient() {
  const links = new Map<string, { user_id: string; username: string | null }>();
  const users = new Map<string, { id: string; email: string; app_metadata: { telegram_id?: string } }>();
  let creates = 0;
  let race = false;
  const client = {
    from(table: string) {
      assert.equal(table, 'telegram_accounts');
      return {
        select() {
          return { eq(_key: string, id: string) {
            return { async maybeSingle() { return { data: links.get(id) || null, error: null }; } };
          } };
        },
        async insert(value: { telegram_id: string; user_id: string; username: string | null }) {
          if (race) {
            race = false;
            links.set(value.telegram_id, { user_id: value.user_id, username: value.username });
            return { error: { code: '23505' } };
          }
          links.set(value.telegram_id, { user_id: value.user_id, username: value.username });
          return { error: null };
        },
        update(value: { username: string | null }) {
          return { eq(_key: string, id: string) {
            const link = links.get(id);
            if (link) link.username = value.username;
            return Promise.resolve({ error: null });
          } };
        },
      };
    },
    auth: { admin: {
      async createUser(value: { email: string; app_metadata: { telegram_id: string } }) {
        if ([...users.values()].some((user) => user.email === value.email))
          return { data: { user: null }, error: { code: 'email_exists' } };
        creates++;
        const user = { id: `user-${creates}`, email: value.email, app_metadata: value.app_metadata };
        users.set(user.id, user);
        return { data: { user }, error: null };
      },
      async getUserById(id: string) { return { data: { user: users.get(id) }, error: null }; },
      async generateLink() { return { data: { properties: { hashed_token: 'token-hash' } }, error: null }; },
      async listUsers() { return { data: { users: [...users.values()] }, error: null }; },
    } },
  };
  return { client, links, users, get creates() { return creates; }, setRace() { race = true; } };
}

test('создаёт пользователя и привязку Telegram', async () => {
  const fake = fakeClient();
  const token = await telegramLogin(fake.client as never, {
    id: '12345', username: 'traveler', first_name: 'Aether',
  }, 'en');
  assert.equal(token, 'token-hash');
  assert.equal(fake.creates, 1);
  assert.equal(fake.links.get('12345')?.user_id, 'user-1');
});

test('повторный вход использует прежнего пользователя', async () => {
  const fake = fakeClient();
  await telegramLogin(fake.client as never, { id: '12345', username: 'first' });
  await telegramLogin(fake.client as never, { id: '12345', username: 'second' });
  assert.equal(fake.creates, 1);
  assert.equal(fake.links.get('12345')?.username, 'second');
});

test('при конфликте вставки использует существующую привязку', async () => {
  const fake = fakeClient();
  fake.setRace();
  assert.equal(await telegramLogin(fake.client as never, { id: '12345' }), 'token-hash');
  assert.equal(fake.links.get('12345')?.user_id, 'user-1');
});

test('не привязывает чужой аккаунт с синтетическим email', async () => {
  const fake = fakeClient();
  fake.users.set('foreign', {
    id: 'foreign', email: 'tg12345@telegram.genshinflex.com', app_metadata: {},
  });
  await assert.rejects(telegramLogin(fake.client as never, { id: '12345' }),
    (error: unknown) => (error as { status?: number }).status === 409);
  assert.equal(fake.links.has('12345'), false);
});

async function signed(authDate: number) {
  const auth = { id: '12345', first_name: 'Aether', auth_date: authDate };
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('123:token'));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const text = Object.entries(auth).map(([name, value]) => `${name}=${value}`).sort().join('\n');
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return { ...auth, hash: Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('') };
}

test('отклоняет подпись старше часа', async () => {
  const now = 1_790_000_000_000;
  const auth = await signed(now / 1000 - 3601);
  assert.equal(await verifyTelegram(auth, '123:token', now, 3_600_000), null);
});

test('язык вне auth не меняет подпись', async () => {
  const now = 1_790_000_000_000;
  const body = { auth: await signed(now / 1000), lang: 'es' };
  assert.equal((await verifyTelegram(body.auth, '123:token', now, 3_600_000))?.id, '12345');
  assert.equal(await verifyTelegram(body, '123:token', now, 3_600_000), null);
});

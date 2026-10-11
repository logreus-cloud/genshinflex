import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkTelegram, telegramLogin, unlinkTelegram } from '../src/lib/telegram-login.ts';
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

type Account = {
  id: string;
  email: string;
  identities: { provider: string }[];
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
};

function linkClient(accounts: Account[], rows: { telegram_id: string; user_id: string }[] = []) {
  const users = new Map(accounts.map((account) => [account.id, account]));
  let failUpdate = false;
  const client = {
    from(table: string) {
      assert.equal(table, 'telegram_accounts');
      const find = (key: string, value: string) => rows.find((row) => String(row[key as 'user_id']) === value) || null;
      return {
        select() {
          return { eq(key: string, value: string) {
            return { async maybeSingle() { return { data: find(key, value), error: null }; } };
          } };
        },
        async insert(value: { telegram_id: string; user_id: string }) {
          if (find('telegram_id', value.telegram_id) || find('user_id', value.user_id)) return { error: { code: '23505' } };
          rows.push({ telegram_id: value.telegram_id, user_id: value.user_id });
          return { error: null };
        },
        update() {
          return { eq() { return Promise.resolve({ error: null }); } };
        },
        delete() {
          return { eq(key: string, value: string) {
            const index = rows.findIndex((row) => String(row[key as 'user_id']) === value);
            if (index >= 0) rows.splice(index, 1);
            return Promise.resolve({ error: null });
          } };
        },
      };
    },
    auth: { admin: {
      async getUserById(id: string) { return { data: { user: users.get(id) || null }, error: null }; },
      async updateUserById(id: string, value: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }) {
        if (failUpdate) return { data: { user: null }, error: { message: 'boom' } };
        const user = users.get(id)!;
        if (value.app_metadata) {
          user.app_metadata = { ...user.app_metadata, ...value.app_metadata };
          for (const [key, item] of Object.entries(user.app_metadata)) if (item === null) delete user.app_metadata[key];
        }
        if (value.user_metadata) user.user_metadata = value.user_metadata;
        return { data: { user }, error: null };
      },
    } },
  };
  return { client: client as never, rows, users, failUpdate() { failUpdate = true; } };
}

const account = (id: string, email = `${id}@example.com`, providers = ['email']): Account => ({
  id, email, identities: providers.map((provider) => ({ provider })),
  app_metadata: { provider: 'email', roles: ['x'] }, user_metadata: { display_name: id },
});
const conflict = (code: string) => (error: unknown) =>
  (error as { status?: number }).status === 409 && (error as { code?: string }).code === code;

test('привязывает свободный Telegram и сохраняет прочие метаданные', async () => {
  const fake = linkClient([account('main')]);
  await linkTelegram(fake.client, 'main', { id: '777', username: 'paimon' });
  assert.deepEqual(fake.rows, [{ telegram_id: '777', user_id: 'main' }]);
  assert.deepEqual(fake.users.get('main')!.app_metadata, { provider: 'email', roles: ['x'], telegram_id: '777' });
  assert.equal(fake.users.get('main')!.user_metadata.telegram_username, 'paimon');
  assert.equal(fake.users.get('main')!.user_metadata.display_name, 'main');
  await linkTelegram(fake.client, 'main', { id: '777' });
  assert.equal(fake.rows.length, 1);
});

test('не привязывает чужой или второй Telegram', async () => {
  const fake = linkClient([account('main'), account('other')], [{ telegram_id: '777', user_id: 'other' }]);
  await assert.rejects(linkTelegram(fake.client, 'main', { id: '777' }), conflict('telegram_taken'));
  fake.rows.push({ telegram_id: '888', user_id: 'main' });
  await assert.rejects(linkTelegram(fake.client, 'main', { id: '999' }), conflict('telegram_already_linked'));
  assert.equal(fake.users.get('main')!.app_metadata.telegram_id, undefined);
});

test('откатывает привязку, если не удалось обновить пользователя', async () => {
  const fake = linkClient([account('main')]);
  fake.failUpdate();
  await assert.rejects(linkTelegram(fake.client, 'main', { id: '777' }));
  assert.deepEqual(fake.rows, []);
});

test('отвязывает Telegram', async () => {
  const fake = linkClient([account('main')]);
  await linkTelegram(fake.client, 'main', { id: '777' });
  await unlinkTelegram(fake.client, 'main');
  assert.deepEqual(fake.rows, []);
  assert.deepEqual(fake.users.get('main')!.app_metadata, { provider: 'email', roles: ['x'] });
  await unlinkTelegram(fake.client, 'main');
});

test('не отвязывает Telegram, если это единственный способ входа', async () => {
  const synthetic = account('tg', 'tg777@telegram.genshinflex.com');
  synthetic.app_metadata.telegram_id = '777';
  const fake = linkClient([synthetic, account('both', 'tg888@telegram.genshinflex.com', ['email', 'discord'])],
    [{ telegram_id: '777', user_id: 'tg' }, { telegram_id: '888', user_id: 'both' }]);
  await assert.rejects(unlinkTelegram(fake.client, 'tg'), conflict('last_method'));
  assert.equal(fake.rows.length, 2);
  await unlinkTelegram(fake.client, 'both');
  assert.deepEqual(fake.rows, [{ telegram_id: '777', user_id: 'tg' }]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminDeleteAccount, banAccount, listAccounts, unbanAccount, validateBan } from '../src/lib/accounts.ts';
import type { Account, AccountClient } from '../src/lib/accounts.ts';

const adminId = '22222222-2222-4222-8222-222222222222';
const userId = '11111111-1111-4111-8111-111111111111';
const otherAdmin = '44444444-4444-4444-8444-444444444444';

function account(id: string): Account {
  return {
    id, email: 'traveler@example.com', created_at: '2026-09-01', last_sign_in_at: null, providers: ['email'],
    banned_until: null, ban_reason: null, nickname: id === userId ? 'traveler' : null, display_name: null,
    is_public: true, roles: id === otherAdmin ? ['admin'] : [], titles: [], forum_banned: false,
    forum_ban_until: null, forum_ban_reason: null, threads: 0, posts: 0, telegram: null, total: 1,
  };
}

function fake() {
  const calls: { kind: string; args: unknown[] }[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ kind: 'rpc', args: [name, args] });
      const id = args.p_id as string | undefined;
      return { data: id ? [account(id)] : [account(userId)], error: null };
    },
    from: (table: string) => ({
      upsert: async (value: unknown, options: unknown) => {
        calls.push({ kind: 'upsert', args: [table, value, options] });
        return { error: null };
      },
      delete: () => ({
        eq: async (column: string, value: unknown) => {
          calls.push({ kind: 'delete', args: [table, column, value] });
          return { error: null };
        },
      }),
    }),
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }) },
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: unknown) => {
          calls.push({ kind: 'update', args: [id, attrs] });
          return { data: {}, error: null };
        },
        deleteUser: async (id: string) => {
          calls.push({ kind: 'deleteUser', args: [id] });
          return { error: null };
        },
        getUserById: async () => ({ data: { user: null }, error: null }),
      },
    },
  } as unknown as AccountClient;
  return { client, calls };
}

test('проверяет срок, тип и причину бана', () => {
  assert.deepEqual(validateBan({ scope: 'site', days: 7, reason: '  спам ' }), { scope: 'site', days: 7, reason: 'спам' });
  assert.equal(validateBan({ scope: 'forum', days: null }).reason, null);
  assert.throws(() => validateBan({ scope: 'chat', days: 1 }), { status: 400 });
  assert.throws(() => validateBan({ scope: 'site', days: 0 }), { status: 400 });
  assert.throws(() => validateBan({ scope: 'site', days: 1.5 }), { status: 400 });
  assert.throws(() => validateBan({ scope: 'site', days: 3651 }), { status: 400 });
  assert.throws(() => validateBan({ scope: 'site' }), { status: 400 });
  assert.throws(() => validateBan({ scope: 'site', days: 1, reason: 'x'.repeat(201) }), { status: 400 });
});

test('не принимает неизвестный фильтр и считает страницу', async () => {
  const { client, calls } = fake();
  await assert.rejects(listAccounts(client, { filter: 'all; drop' }), { status: 400 });
  const result = await listAccounts(client, { q: ' trav ', filter: 'banned', page: '2' });
  assert.equal(result.total, 1);
  assert.equal(result.page, 2);
  assert.deepEqual(calls.at(-1)!.args[1], { p_query: 'trav', p_filter: 'banned', p_limit: 50, p_offset: 100 });
  assert.equal((await listAccounts(client, { page: '-1' })).page, 0);
  await assert.rejects(listAccounts(client, { page: '42949673' }), { status: 400 });
});

test('банит на сайте на срок и навсегда, снимает бан', async () => {
  const { client, calls } = fake();
  await banAccount(client, adminId, userId, { scope: 'site', days: 7, reason: 'спам' });
  assert.deepEqual(calls.find((c) => c.kind === 'update')!.args, [userId, { ban_duration: '168h', app_metadata: { ban_reason: 'спам' } }]);
  await banAccount(client, adminId, userId, { scope: 'site', days: null });
  assert.equal((calls.filter((c) => c.kind === 'update').at(-1)!.args[1] as { ban_duration: string }).ban_duration, '876000h');
  await unbanAccount(client, userId, 'site');
  assert.deepEqual(calls.filter((c) => c.kind === 'update').at(-1)!.args[1], { ban_duration: 'none', app_metadata: { ban_reason: null } });
});

test('банит на форуме через upsert и снимает бан', async () => {
  const { client, calls } = fake();
  const now = Date.parse('2026-10-04T00:00:00Z');
  await banAccount(client, adminId, userId, { scope: 'forum', days: 1, reason: '' }, now);
  const [table, value, options] = calls.find((c) => c.kind === 'upsert')!.args;
  assert.equal(table, 'forum_bans');
  assert.deepEqual(value, {
    user_id: userId, until: '2026-10-05T00:00:00.000Z', reason: null, created_by: adminId, created_at: '2026-10-04T00:00:00.000Z',
  });
  assert.deepEqual(options, { onConflict: 'user_id' });
  await unbanAccount(client, userId, 'forum');
  assert.deepEqual(calls.find((c) => c.kind === 'delete')!.args, ['forum_bans', 'user_id', userId]);
  await assert.rejects(unbanAccount(client, userId, 'chat'), { status: 400 });
});

test('не трогает свой аккаунт и администраторов', async () => {
  const { client, calls } = fake();
  await assert.rejects(banAccount(client, adminId, adminId, { scope: 'site', days: 1 }), { status: 403 });
  await assert.rejects(banAccount(client, adminId, otherAdmin, { scope: 'forum', days: 1 }), { status: 403 });
  await assert.rejects(adminDeleteAccount(client, adminId, otherAdmin, otherAdmin), { status: 403 });
  await assert.rejects(banAccount(client, adminId, 'not-a-uuid', { scope: 'site', days: 1 }), { status: 400 });
  assert.equal(calls.some((c) => c.kind === 'update' || c.kind === 'upsert' || c.kind === 'deleteUser'), false);
});

test('удаляет аккаунт только после ввода ника', async () => {
  const { client, calls } = fake();
  await assert.rejects(adminDeleteAccount(client, adminId, userId, 'Traveler'), { status: 400 });
  assert.equal(calls.some((c) => c.kind === 'deleteUser'), false);
  await adminDeleteAccount(client, adminId, userId, 'traveler');
  assert.deepEqual(calls.find((c) => c.kind === 'deleteUser')!.args, [userId]);
});

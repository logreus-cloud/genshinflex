import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount, exportAccount } from '../src/lib/account.ts';
import type { AdminClient } from '../src/lib/account.ts';
import type { TokenClaims } from '../src/lib/auth.ts';

const id = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-09-27T12:00:00Z');
const claims = (age: number): TokenClaims => ({
  sub: id,
  iat: Math.floor(now / 1000),
  amr: [{ method: 'password', timestamp: Math.floor(now / 1000) - age }],
});

function deletionClient() {
  const calls: { method: string; args: unknown[] }[] = [];
  const list = async (...args: unknown[]) => {
    calls.push({ method: 'list', args });
    return { data: [{ id: 'a', name: 'one.png' }, { id: 'b', name: 'two.webp' }], error: null };
  };
  const remove = async (...args: unknown[]) => {
    calls.push({ method: 'remove', args });
    return { error: null };
  };
  const deleteUser = async (...args: unknown[]) => {
    calls.push({ method: 'deleteUser', args });
    return { error: null };
  };
  const client = {
    storage: { from: () => ({ list, remove }) },
    auth: { admin: { deleteUser } },
  } as unknown as AdminClient;
  return { client, calls };
}

test('removes avatars before deleting a user after a fresh sign-in', async () => {
  const { client, calls } = deletionClient();
  assert.equal(await deleteAccount(client, id, 'DELETE', claims(60), now), null);
  assert.deepEqual(calls, [
    { method: 'list', args: [id, { limit: 100, offset: 0 }] },
    { method: 'remove', args: [[`${id}/one.png`, `${id}/two.webp`]] },
    { method: 'deleteUser', args: [id, false] },
  ]);
});

test('requires a new sign-in when the last authentication is old', async () => {
  const { client, calls } = deletionClient();
  assert.equal(await deleteAccount(client, id, 'DELETE', claims(901), now), 'reauth_required');
  assert.deepEqual(calls, []);
});

test('requires the exact confirmation', async () => {
  const { client, calls } = deletionClient();
  assert.equal(await deleteAccount(client, id, 'delete', claims(60), now), 'confirmation_required');
  assert.deepEqual(calls, []);
});

test('includes every export section without provider tokens', async () => {
    const row = (data: unknown) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data, error: null }),
          then: (resolve: (value: { data: unknown; error: null }) => void) => resolve({ data, error: null }),
        }),
      }),
    });
    const rows: Record<string, unknown> = {
      profiles: { id, nickname: 'traveler' },
      user_data: { user_id: id, favorites: [] },
      roles: [{ user_id: id, role: 'author' }],
      telegram_accounts: { user_id: id, telegram_id: 123 },
    };
    const client = {
      from: (table: string) => row(rows[table]),
      auth: {
        admin: {
          getUserById: async () => ({
            data: {
              user: {
                id, email: 'user@example.com', created_at: '2026-09-01',
                last_sign_in_at: '2026-09-27',
                identities: [{
                  provider: 'google',
                  identity_data: { email: 'user@example.com', name: 'Traveler', provider_token: 'secret' },
                }],
                user_metadata: { display_name: 'Traveler', provider_token: 'secret' },
              },
            },
            error: null,
          }),
        },
      },
    } as unknown as AdminClient;
    const data = await exportAccount(client, id);
    assert.equal(data.auth.id, id);
    assert.equal(data.auth.email, 'user@example.com');
    assert.deepEqual(data.auth.providers, [{
      provider: 'google', email: 'user@example.com', name: 'Traveler',
    }]);
    assert.deepEqual(data.auth.user_metadata, { display_name: 'Traveler' });
    assert.deepEqual(data.profile, rows.profiles);
    assert.deepEqual(data.user_data, rows.user_data);
    assert.deepEqual(data.roles, rows.roles);
    assert.deepEqual(data.telegram, rows.telegram_accounts);
    assert.ok(data.exported_at);
    assert.equal(JSON.stringify(data).includes('secret'), false);
    assert.equal(JSON.stringify(data).includes('provider_token'), false);
});

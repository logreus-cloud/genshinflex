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
  const list = async (bucket: string, ...args: unknown[]) => {
    calls.push({ method: 'list', args: [bucket, ...args] });
    return { data: [{ id: 'a', name: 'one.png' }, { id: 'b', name: 'two.webp' }], error: null };
  };
  const remove = async (bucket: string, ...args: unknown[]) => {
    calls.push({ method: 'remove', args: [bucket, ...args] });
    return { error: null };
  };
  const deleteUser = async (...args: unknown[]) => {
    calls.push({ method: 'deleteUser', args });
    return { error: null };
  };
  const client = {
    storage: { from: (bucket: string) => ({ list: (...args: unknown[]) => list(bucket, ...args), remove: (...args: unknown[]) => remove(bucket, ...args) }) },
    auth: { admin: { deleteUser } },
  } as unknown as AdminClient;
  return { client, calls };
}

test('removes avatars and profile media before deleting a user after a fresh sign-in', async () => {
  const { client, calls } = deletionClient();
  assert.equal(await deleteAccount(client, id, 'DELETE', claims(60), now), null);
  assert.deepEqual(calls, [
    { method: 'list', args: ['avatars', id, { limit: 100, offset: 0 }] },
    { method: 'remove', args: ['avatars', [`${id}/one.png`, `${id}/two.webp`]] },
    { method: 'list', args: ['profile-media', id, { limit: 100, offset: 0 }] },
    { method: 'remove', args: ['profile-media', [`${id}/one.png`, `${id}/two.webp`]] },
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
    const wishes = Array.from({ length: 1001 }, (_, index) => ({ user_id: id, game_uid: '700000000', id: String(index + 1) }));
    const posts = Array.from({ length: 1001 }, (_, index) => ({ author_id: id, id: index + 1, deleted_at: index === 0 ? '2026-09-27' : null }));
    const threads = Array.from({ length: 1001 }, (_, index) => ({ author_id: id, id: index + 1 }));
    const reactions = Array.from({ length: 1001 }, (_, index) => ({ user_id: id, post_id: index + 1, kind: 'heart' }));
    const reports = Array.from({ length: 1001 }, (_, index) => ({ reporter_id: id, id: index + 1 }));
    const following = { follower_id: id, followee_id: '22222222-2222-4222-8222-222222222222' };
    const follower = { follower_id: '33333333-3333-4333-8333-333333333333', followee_id: id };
    const requestedFriendship = { requester_id: id, addressee_id: following.followee_id, status: 'pending' };
    const receivedFriendship = { requester_id: follower.follower_id, addressee_id: id, status: 'accepted' };
    const block = { blocker_id: id, blocked_id: '44444444-4444-4444-8444-444444444444' };
    const inboundBlock = { blocker_id: following.followee_id, blocked_id: id };
    const notification = { id: 1, recipient_id: id, actor_id: following.followee_id, kind: 'follow' };
    const anotherNotification = { id: 2, recipient_id: id, actor_id: follower.follower_id, kind: 'follow' };
    const outboundNotification = { id: 3, recipient_id: following.followee_id, actor_id: id, kind: 'follow' };
    const conversations = [
      { id: 1, pair_key: 'first' },
      { id: 2, pair_key: 'second' },
    ];
    const members = [
      { conversation_id: 1, user_id: id },
      { conversation_id: 1, user_id: following.followee_id },
      { conversation_id: 2, user_id: id },
      { conversation_id: 2, user_id: follower.follower_id },
    ];
    const messages = [
      ...Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, conversation_id: 1, sender_id: index % 2 ? following.followee_id : id, body: 'Hello' })),
      { id: 1002, conversation_id: 2, sender_id: follower.follower_id, body: '', deleted_at: '2026-09-27' },
    ];
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
      forum_bans: { user_id: id, reason: 'Pause' },
    };
    const ranges: { table: string; start: number; end: number }[] = [];
    const orders: { table: string; column: string }[] = [];
    const filters: { table: string; key: string; value: unknown }[] = [];
    const inFilters: { table: string; key: string; values: unknown[] }[] = [];
    const collections: Record<string, unknown[]> = {
      wishes,
      forum_threads: threads,
      forum_posts: posts,
      forum_reactions: reactions,
      forum_reports: reports,
      social_follows: [following, follower],
      social_friendships: [requestedFriendship, receivedFriendship],
      social_blocks: [block, inboundBlock],
      notifications: [notification, anotherNotification, outboundNotification],
      dm_conversations: [...conversations, { id: 3, pair_key: 'unrelated' }],
      dm_members: [...members, { conversation_id: 3, user_id: outboundNotification.recipient_id }],
      dm_messages: [...messages, { id: 1003, conversation_id: 3, sender_id: id, body: 'Unrelated' }],
      guild_members: [{ user_id: id, guild_id: 7 }, { user_id: outboundNotification.recipient_id, guild_id: 7 }],
      guilds: [{ id: 7, slug: 'mine', owner_id: id }, { id: 8, slug: 'other', owner_id: outboundNotification.recipient_id }],
      forum_thread_views: [{ thread_id: 1, user_id: id, day: '2026-10-10' }, { thread_id: 1, user_id: outboundNotification.recipient_id, day: '2026-10-10' }],
    };
    const client = {
      from: (table: string) => table in collections ? (() => {
        let matches = (_item: Record<string, unknown>) => true;
        const query = {
            select: () => query,
            eq: (key: string, value: unknown) => {
              filters.push({ table, key, value });
              matches = (item: Record<string, unknown>) => item[key] === value;
              return query;
            },
            in: (key: string, values: unknown[]) => {
              inFilters.push({ table, key, values });
              matches = (item: Record<string, unknown>) => values.includes(item[key]);
              return query;
            },
            order: (column: string) => {
              orders.push({ table, column });
              return query;
            },
            range: async (start: number, end: number) => {
              ranges.push({ table, start, end });
              return {
                data: collections[table]!.filter((item) => matches(item as Record<string, unknown>)).slice(start, end + 1),
                error: null,
              };
            },
        };
        return query;
      })() : row(rows[table]),
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
    assert.deepEqual(data.wishes, wishes);
    for (const table of ['wishes', 'forum_threads', 'forum_posts', 'forum_reactions', 'forum_reports']) {
      assert.deepEqual(ranges.filter((entry) => entry.table === table), [
        { table, start: 0, end: 999 },
        { table, start: 1000, end: 1999 },
      ]);
    }
    assert.deepEqual(ranges.filter((entry) => entry.table === 'dm_messages'), [
      { table: 'dm_messages', start: 0, end: 999 },
      { table: 'dm_messages', start: 1000, end: 1999 },
    ]);
    const columns: Record<string, string[]> = {
      wishes: ['game_uid', 'id'],
      forum_threads: ['id'],
      forum_posts: ['id'],
      forum_reactions: ['post_id', 'kind'],
      forum_reports: ['id'],
    };
    for (const [table, list] of Object.entries(columns)) {
      assert.deepEqual(orders.filter((entry) => entry.table === table).map((entry) => entry.column), [...list, ...list]);
    }
    assert.deepEqual(orders.filter((entry) => entry.table === 'social_follows').map((entry) => entry.column), [
      'followee_id', 'follower_id',
    ]);
    assert.deepEqual(orders.filter((entry) => entry.table === 'social_friendships').map((entry) => entry.column), [
      'requester_id', 'addressee_id', 'requester_id', 'addressee_id',
    ]);
    assert.deepEqual(orders.filter((entry) => entry.table === 'social_blocks').map((entry) => entry.column), [
      'blocked_id',
    ]);
    assert.deepEqual(filters.filter((entry) => entry.table === 'notifications'), [
      { table: 'notifications', key: 'recipient_id', value: id },
    ]);
    assert.deepEqual(orders.filter((entry) => entry.table === 'notifications').map((entry) => entry.column), ['id']);
    assert.deepEqual(filters.filter((entry) => entry.table === 'dm_members'), [
      { table: 'dm_members', key: 'user_id', value: id },
    ]);
    assert.deepEqual(inFilters, [
      { table: 'dm_conversations', key: 'id', values: [1, 2] },
      { table: 'dm_members', key: 'conversation_id', values: [1, 2] },
      { table: 'dm_messages', key: 'conversation_id', values: [1, 2] },
      { table: 'dm_messages', key: 'conversation_id', values: [1, 2] },
    ]);
    assert.deepEqual(data.roles, rows.roles);
    assert.deepEqual(data.telegram, rows.telegram_accounts);
    assert.deepEqual(data.forum, {
      threads, posts, reactions,
      reports, ban: rows.forum_bans,
      views: [{ thread_id: 1, user_id: id, day: '2026-10-10' }],
    });
    assert.deepEqual(data.guilds, {
      membership: [{ user_id: id, guild_id: 7 }],
      owned: [{ id: 7, slug: 'mine', owner_id: id }],
    });
    assert.deepEqual(data.social, {
      following: [following],
      followers: [follower],
      friendships: [requestedFriendship, receivedFriendship],
      blocks: [block],
    });
    assert.deepEqual(data.notifications, [notification, anotherNotification]);
    assert.deepEqual(data.messages, { conversations, members, messages });
    assert.ok(data.exported_at);
    assert.equal(JSON.stringify(data).includes('secret'), false);
    assert.equal(JSON.stringify(data).includes('provider_token'), false);

    collections.dm_members = [];
    const relatedQueries = inFilters.length;
    const empty = await exportAccount(client, id);
    assert.deepEqual(empty.messages, { conversations: [], members: [], messages: [] });
    assert.equal(inFilters.length, relatedQueries);
});

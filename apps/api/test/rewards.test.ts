import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grantReward, revokeReward } from '../src/lib/rewards.ts';
import type { RewardClient } from '../src/lib/rewards.ts';
import { searchUsers } from '../src/lib/titles.ts';
import type { TitleClient } from '../src/lib/titles.ts';

const id = '11111111-1111-4111-8111-111111111111';

test('grants and revokes profile rewards', async () => {
  let known = true;
  const grants = new Set<string>();
  const client = {
    from: (table: string) => {
      if (table === 'rewards') return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: known ? { id: 'crimson-ring' } : null, error: null }),
          }),
        }),
      };
      if (table === 'user_rewards') return {
        insert: async (row: { reward_id: string }) => {
          if (grants.has(row.reward_id)) return { error: { code: '23505' } };
          grants.add(row.reward_id);
          return { error: null };
        },
        delete: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  if (!grants.delete('crimson-ring')) return { data: null, error: null };
                  return { data: { reward_id: 'crimson-ring' }, error: null };
                },
              }),
            }),
          }),
        }),
      };
      throw new Error('Unexpected table');
    },
  } as unknown as RewardClient;

  await assert.rejects(grantReward(client, 'bad', { reward: 'crimson-ring' }, id), { status: 400 });
  await assert.rejects(grantReward(client, id, { reward: 'Bad ID' }, id), { status: 400 });
  known = false;
  await assert.rejects(grantReward(client, id, { reward: 'unknown-reward' }, id), { status: 404 });
  known = true;
  assert.deepEqual(await grantReward(client, id, { reward: 'crimson-ring' }, id), { ok: true });
  assert.deepEqual(await grantReward(client, id, { reward: 'crimson-ring' }, id), { ok: true });
  assert.equal(grants.size, 1);
  assert.deepEqual(await revokeReward(client, id, 'crimson-ring'), { ok: true });
  await assert.rejects(revokeReward(client, id, 'crimson-ring'), { status: 404 });
});

test('searchUsers includes granted reward ids', async () => {
  const profile = { id, nickname: 'user', display_name: 'User' };
  const client = {
    from: (table: string) => {
      if (table === 'profiles') return {
        select: () => ({
          or: () => ({
            order: () => ({
              limit: async () => ({ data: [profile], error: null }),
            }),
          }),
        }),
      };
      const rows = table === 'user_titles' ? [{ user_id: id, title_id: 'admin' }]
        : table === 'user_rewards' ? [{ user_id: id, reward_id: 'crimson-ring' }] : [];
      return {
        select: () => ({
          in: async () => ({ data: rows, error: null }),
        }),
      };
    },
  } as unknown as TitleClient;

  assert.deepEqual(await searchUsers(client, 'us'), [{
    ...profile,
    titles: ['admin'],
    roles: [],
    rewards: ['crimson-ring'],
  }]);
});

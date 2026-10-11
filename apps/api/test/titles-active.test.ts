import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grantTitle, revokeTitle } from '../src/lib/titles.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';

// Запоминает изменения profiles; select отдаёт заданные строки
function fakeClient(state: { active: string | null; rest: string | null }) {
  const updates: { value: unknown; filters: string[] }[] = [];
  const from = (table: string) => {
    const filters: string[] = [];
    let update: unknown;
    const result = () => {
      if (update !== undefined) return { data: null, error: null };
      if (table === 'profiles') return { data: { active_title: state.active }, error: null };
      if (table === 'user_titles' && filters.includes('delete')) return { data: { title_id: 'x' }, error: null };
      return { data: state.rest ? { title_id: state.rest } : null, error: null };
    };
    const chain: any = {
      select: () => chain,
      insert: async () => ({ error: null }),
      delete: () => { filters.push('delete'); return chain; },
      update: (value: unknown) => { update = value; updates.push({ value, filters }); return chain; },
      eq: (column: string, value: unknown) => { filters.push(`${column}=${value}`); return chain; },
      is: (column: string, value: unknown) => { filters.push(`${column} is ${value}`); return chain; },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  };
  return { client: { from } as any, updates };
}

test('выданный титул становится активным, если активного нет', async () => {
  const { client, updates } = fakeClient({ active: null, rest: null });
  await grantTitle(client, userId, { title: 'tester' }, adminId);
  assert.deepEqual(updates, [{ value: { active_title: 'tester' }, filters: [`id=${userId}`, 'active_title is null'] }]);
});

test('при отзыве активного титула активным становится последний оставшийся', async () => {
  const active = fakeClient({ active: 'moderator', rest: 'tester' });
  await revokeTitle(active.client, userId, 'moderator');
  assert.deepEqual(active.updates.map((item) => item.value), [{ active_title: 'tester' }]);
  assert.ok(active.updates[0].filters.includes('active_title is null'));

  const other = fakeClient({ active: null, rest: 'tester' });
  await revokeTitle(other.client, userId, 'moderator');
  assert.equal(other.updates.length, 0);

  const last = fakeClient({ active: 'moderator', rest: null });
  await revokeTitle(last.client, userId, 'moderator');
  assert.equal(last.updates.length, 0);
});

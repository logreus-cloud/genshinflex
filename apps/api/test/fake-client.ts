import type { ServiceClient } from '../src/index.ts';

export const userId = '11111111-1111-4111-8111-111111111111';
export const adminId = '22222222-2222-4222-8222-222222222222';
const telegramUserId = '33333333-3333-4333-8333-333333333333';

type Result = { data: unknown; error: null };
type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  order: (column: string) => Query;
  range: (start: number, end: number) => Promise<Result>;
  maybeSingle: () => Promise<Result>;
  insert: (value: unknown) => Promise<{ error: null }>;
  update: (value: unknown) => Query;
  then: (resolve: (result: Result) => unknown) => Promise<unknown>;
};

export function fakeClient() {
  const deleted: string[] = [];
  const from = (table: string): Query => {
    let selectedUser: unknown;
    const data = () => {
      if (table === 'profiles') return { id: userId, nickname: 'traveler' };
      if (table === 'user_data') return { user_id: userId, favorites: [] };
      if (table === 'roles') return selectedUser === adminId ? [{ role: 'admin' }] : [];
      return null;
    };
    const result = (): Result => ({ data: data(), error: null });
    const query: Query = {
      select: () => query,
      eq: (column, value) => {
        if (column === 'user_id') selectedUser = value;
        return query;
      },
      order: () => query,
      range: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({
        data: table === 'roles' ? (selectedUser === adminId ? { role: 'admin' } : null) : data(),
        error: null,
      }),
      insert: async () => ({ error: null }),
      update: () => query,
      then: (resolve) => Promise.resolve(resolve(result())),
    };
    return query;
  };
  const client = {
    from,
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: {
            user: {
              id,
              email: id === telegramUserId ? 'tg12345@telegram.genshinflex.com' : 'traveler@example.com',
              created_at: '2026-09-01',
              last_sign_in_at: null,
              identities: [],
              user_metadata: { display_name: 'Traveler', provider_token: 'secret' },
              app_metadata: { telegram_id: '12345' },
            },
          },
          error: null,
        }),
        createUser: async () => ({ data: { user: { id: telegramUserId } }, error: null }),
        generateLink: async () => ({ data: { properties: { hashed_token: 'fake-token-hash' } }, error: null }),
        listUsers: async () => ({ data: { users: [] }, error: null }),
        deleteUser: async (id: string) => {
          deleted.push(id);
          return { error: null };
        },
      },
    },
  } as unknown as ServiceClient;
  return { client, deleted };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadDiscordProfile } from '../src/lib/discord-profile.ts';
import type { PublicProfileClient } from '../src/lib/discord-profile.ts';

const site = 'https://genshinflex.com';
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  nickname: 'traveler',
  display_name: 'Traveler',
  created_at: '2026-09-01',
  active_title: 'title-id',
  custom: { nick: 'Путешественник', avatar: { type: 'upload' }, media: { avatar: 'file.webp' }, color: 'pyro' },
};

function fakeProfileClient(profile: unknown = row, failedRpc?: string) {
  const calls: string[] = [];
  const client = {
    from: (table: string) => {
      calls.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        abortSignal: () => query,
        maybeSingle: async () => ({
          data: table === 'public_profiles' ? profile : { name_ru: 'Искатель', color: '#ffffff' },
          error: null,
        }),
      };
      return query;
    },
    rpc: (name: string) => {
      calls.push(name);
      if (name === failedRpc) {
        const request = Promise.resolve({ data: null, error: new Error('offline') });
        return Object.assign(request, { abortSignal: () => request });
      }
      const data: Record<string, unknown> = {
        guild_of: [{ tag: 'GF', name: 'Гильдия' }],
        forum_user_score: [{ points: 42, place: 3 }],
        social_counts: { followers: 5, friends: 2, lists_hidden: false },
        public_profile_extras: { uid: '123456789' },
      };
      const request = Promise.resolve({ data: data[name], error: null });
      return Object.assign(request, { abortSignal: () => request });
    },
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://supabase.example/storage/v1/object/public/profile-media/${path}` },
        }),
      }),
    },
  };
  return { client: client as unknown as PublicProfileClient, calls };
}

test('собирает карточку из публичных запросов', async () => {
  const { client, calls } = fakeProfileClient();
  const card = await loadDiscordProfile(client, 'traveler', site);
  assert.deepEqual(card, {
    nickname: 'traveler', name: 'Путешественник', createdAt: '2026-09-01',
    avatar: `https://supabase.example/storage/v1/object/public/profile-media/${row.id}/avatar-file.webp`,
    color: 0xEF7938, title: 'Искатель', guild: '[GF] Гильдия',
    forum: { points: 42, place: 3 }, followers: 5, friends: 2,
    listsHidden: false, uid: '123456789',
  });
  assert.ok(calls.includes('public_profiles'));
  assert.ok(calls.includes('titles'));
  assert.ok(calls.includes('public_profile_extras'));
});

test('загружает и кэширует иконку персонажа', async () => {
  const profile = { ...row, custom: { avatar: { type: 'character', slug: 'aino' }, color: '#123abc' } };
  const { client } = fakeProfileClient(profile);
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({ characters: [{ s: 'aino', i: '/img/aino.webp' }] });
  }) as typeof fetch;
  const uniqueSite = `https://${crypto.randomUUID()}.example.com`;
  const first = await loadDiscordProfile(client, 'traveler', uniqueSite, fetcher);
  const second = await loadDiscordProfile(client, 'traveler', uniqueSite, fetcher);
  assert.equal(first?.avatar, `${uniqueSite}/img/aino.webp`);
  assert.equal(first?.color, 0x123ABC);
  assert.equal(second?.avatar, first?.avatar);
  assert.equal(calls, 1);
});

test('не раскрывает скрытых друзей и неопубликованный UID', async () => {
  const { client } = fakeProfileClient({ ...row, custom: { color: 'мусор' } }, 'public_profile_extras');
  const card = await loadDiscordProfile(client, 'traveler', site);
  assert.equal(card?.color, 0xD3BC8E);
  assert.equal(card?.uid, undefined);
  const hidden = fakeProfileClient({ ...row, custom: {} });
  const originalRpc = hidden.client.rpc.bind(hidden.client);
  hidden.client.rpc = ((name: string, args: unknown) => name === 'social_counts'
    ? Promise.resolve({ data: { followers: 5, friends: 2, lists_hidden: true }, error: null })
    : originalRpc(name, args)) as typeof hidden.client.rpc;
  const hiddenCard = await loadDiscordProfile(hidden.client, 'traveler', site);
  assert.equal(hiddenCard?.followers, 5);
  assert.equal(hiddenCard?.friends, undefined);
});

test('не запрашивает невалидный ник и возвращает null для отсутствующего профиля', async () => {
  const invalid = fakeProfileClient();
  assert.equal(await loadDiscordProfile(invalid.client, 'x', site), null);
  assert.deepEqual(invalid.calls, []);
  assert.equal(await loadDiscordProfile(fakeProfileClient(null).client, 'traveler', site), null);
});

test('пропускает зависший вспомогательный запрос до общего дедлайна', async () => {
  const { client } = fakeProfileClient();
  const originalRpc = client.rpc.bind(client);
  let requestSignal: AbortSignal | undefined;
  client.rpc = ((name: string, args: unknown) => {
    if (name !== 'guild_of') return originalRpc(name, args);
    const request = new Promise<never>(() => {});
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        requestSignal = signal;
        return request;
      },
    });
  }) as typeof client.rpc;
  const controller = new AbortController();
  const started = Date.now();
  const card = await loadDiscordProfile(client, 'traveler', site, fetch, controller.signal, started + 20);
  assert.ok(Date.now() - started < 500);
  assert.equal(card?.guild, undefined);
  assert.equal(card?.title, 'Искатель');
  assert.equal(requestSignal, controller.signal);
  controller.abort();
  assert.equal(requestSignal?.aborted, true);
});

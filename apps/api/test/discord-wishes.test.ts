import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/index.ts';
import { handleInteraction } from '../src/lib/discord.ts';
import { bannersReply, parseBannersData, serverMoment } from '../src/lib/discord-wishes.ts';
import type { DiscordBannersData, PityData, PityGroup } from '../src/lib/discord-wishes.ts';
import type { Env } from '../src/lib/env.ts';

const site = 'https://genshinflex.com';
const data: DiscordBannersData = {
  banners: [{
    version: '7.1', phase: 1, start: '2026-09-23T11:00', end: '2026-10-13T18:00',
    featured: [{ s: 'vesna', n: 'Весна', el: 'hydro', i: 'https://genshinflex.com/img/vesna.webp' }, { s: 'vodyanitsa', n: 'Водяница' }],
    fourStars: ['Фарузан', 'Диона'], weapons: ['Меч'],
  }, {
    version: '7.1', phase: 2, start: '2026-10-13T18:00', end: '2026-11-03T15:00',
    featured: [{ s: 'skirk', n: 'Скирк', el: 'cryo', rerun: true }], fourStars: [], weapons: [],
  }],
  standard: [{ id: '10000016', names: ['дилюк', 'diluc'] }, { id: '10000041', names: ['мона', 'mona'] }],
};
const group = (key: PityGroup['key'], extra: Partial<PityGroup> = {}): PityGroup =>
  ({ key, total: 100, p5: 10, p4: 2, last5_name: null, last5_item_id: null, ...extra });
const baseDeps = { loadBuilds: async () => [], site, loadBanners: async () => data };
const pityCommand = { type: 2, data: { name: 'гарант' }, member: { user: { id: '42' } } };

test('время баннеров считается по серверу Европы', () => {
  assert.equal(serverMoment('2026-10-13T18:00'), Date.UTC(2026, 9, 13, 17, 0));
  assert.ok(Number.isNaN(serverMoment('мусор')));
});

test('/баннеры показывает текущую фазу и следующую', async () => {
  const now = Date.UTC(2026, 9, 1);
  const reply = bannersReply(data, site, { hydro: 0x4CC2F1 }, now) as any;
  assert.equal(reply.data.flags, undefined);
  assert.equal(reply.data.embeds.length, 1);
  const [embed] = reply.data.embeds;
  assert.equal(embed.title, 'Молитвы 7.1, фаза 1');
  assert.equal(embed.color, 0x4CC2F1);
  assert.equal(embed.thumbnail.url, 'https://genshinflex.com/img/vesna.webp');
  assert.match(embed.description, /★5: Весна, Водяница/);
  assert.match(embed.description, /★4: Фарузан, Диона/);
  assert.match(embed.description, new RegExp(`<t:${Date.UTC(2026, 9, 13, 17) / 1000}:R>`));
  assert.match(embed.fields[0].value, /Скирк \(повтор\) — старт <t:\d+:R>/);
  assert.equal(reply.data.components[0].components[0].url, `${site}/banners/`);
});

test('/баннеры без текущих фаз и без данных', async () => {
  const between = { ...data, banners: [data.banners[1]] };
  const waiting = bannersReply(between, site, {}, Date.UTC(2026, 9, 1)) as any;
  assert.match(waiting.data.content, /^Сейчас баннеры не идут\. Дальше: Скирк/);
  const empty = bannersReply({ banners: [], standard: [] }, site, {}, Date.UTC(2026, 9, 1)) as any;
  assert.equal(empty.data.content, 'Данных о баннерах пока нет');
  const failed = await handleInteraction({ type: 2, data: { name: 'баннеры' } }, {
    ...baseDeps, loadBanners: async () => { throw new Error('сеть'); },
  }) as any;
  assert.equal(failed.data.flags, 64);
  assert.match(failed.data.content, /Баннеры временно недоступны/);
});

test('данные баннеров проверяются, битые записи отбрасываются', () => {
  const parsed = parseBannersData({
    banners: [data.banners[0], { version: '1', phase: 1, start: 'вчера', end: '2026-01-01T00:00', featured: [], fourStars: [], weapons: [] }],
    standard: [...data.standard, { id: 5, names: [] }],
  });
  assert.equal(parsed.banners.length, 1);
  assert.equal(parsed.standard.length, 2);
  assert.throws(() => parseBannersData({ banners: [] }));
});

test('/гарант без привязки и без истории отвечает эфемерно', async () => {
  const unlinked = await handleInteraction(pityCommand, { ...baseDeps, loadPity: async () => null }) as any;
  assert.equal(unlinked.data.flags, 64);
  assert.match(unlinked.data.content, /Discord не привязан.*\/account\//);
  const empty = await handleInteraction(pityCommand, { ...baseDeps, loadPity: async () => ({ uids: [] }) }) as any;
  assert.equal(empty.data.flags, 64);
  assert.match(empty.data.content, /История молитв не загружена.*\/tools\/wishes\//);
});

test('/гарант считает 50/50 и гарантированный лимитный', async () => {
  let receivedId = '';
  const pity: PityData = { uids: [
    { game_uid: '700000001', groups: [
      group('weapon', { p5: 65, p4: 3 }),
      group('char', { p5: 75, p4: 4, last5_name: 'Дилюк', last5_item_id: '' }),
    ] },
    { game_uid: 'manual', groups: [group('char', { last5_name: 'Скирк', last5_item_id: '10000114' })] },
  ] };
  const reply = await handleInteraction(pityCommand, {
    ...baseDeps, loadPity: async (id) => { receivedId = id; return pity; },
  }) as any;
  assert.equal(receivedId, '42');
  assert.equal(reply.data.flags, 64);
  const [first, manual] = reply.data.embeds[0].fields;
  assert.equal(first.name, 'UID 700000001');
  assert.deepEqual(first.value.split('\n'), [
    'Событие персонажа: **75**/90 · 4★ 4/10 · следующий 5★ — гарантированно лимитный · мягкий гарант',
    'Оружие: **65**/80 · 4★ 3/10 · мягкий гарант',
  ]);
  assert.equal(manual.name, 'Ручной ввод');
  assert.equal(manual.value, 'Событие персонажа: **10**/90 · 4★ 2/10 · 50/50');
  const byId = await handleInteraction(pityCommand, {
    ...baseDeps, loadPity: async () => ({ uids: [{ game_uid: '700000001', groups: [group('char', { last5_name: 'Mona?', last5_item_id: '10000041' })] }] }),
  }) as any;
  assert.match(byId.data.embeds[0].fields[0].value, /гарантированно лимитный/);
});

test('/гарант без данных баннеров показывает счётчики без 50/50, ошибки — эфемерно', async () => {
  const pity: PityData = { uids: [{ game_uid: '700000001', groups: [group('char'), group('standard')] }] };
  const noBanners = await handleInteraction(pityCommand, {
    ...baseDeps, loadBanners: async () => { throw new Error('сеть'); }, loadPity: async () => pity,
  }) as any;
  assert.deepEqual(noBanners.data.embeds[0].fields[0].value.split('\n'), [
    'Событие персонажа: **10**/90 · 4★ 2/10',
    'Стандартный: **10**/90 · 4★ 2/10',
  ]);
  const failed = await handleInteraction(pityCommand, { ...baseDeps, loadPity: async () => { throw new Error('база'); } }) as any;
  assert.equal(failed.data.flags, 64);
  assert.match(failed.data.content, /Гарант временно недоступен/);
  let signal: AbortSignal | undefined;
  const started = Date.now();
  const hung = await handleInteraction(pityCommand, {
    ...baseDeps, loadPity: (_id, s) => { signal = s; return new Promise(() => {}); },
  }) as any;
  assert.ok(Date.now() - started < 2_500);
  assert.match(hung.data.content, /Гарант временно недоступен/);
  assert.equal(signal?.aborted, true);
});

test('маршрут передаёт загрузчики баннеров и гаранта', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const env = { SITE_ORIGINS: '', DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey('raw', pair.publicKey)) } as Env;
  let bannersUrl = '';
  let pityId = '';
  const app = createApp({
    discordBanners: async (url) => { bannersUrl = url; return data; },
    discordPity: async (id, bindings) => { pityId = id; assert.equal(bindings, env); return null; },
  });
  const send = async (body: string) => {
    const timestamp = '123456';
    const signature = hex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(timestamp + body)));
    const response = await app.request('/discord/interactions', {
      method: 'POST', body, headers: { 'X-Signature-Timestamp': timestamp, 'X-Signature-Ed25519': signature },
    }, env);
    return await response.json() as any;
  };
  const banners = await send('{"type":2,"data":{"name":"баннеры"}}');
  assert.equal(bannersUrl, 'https://genshinflex.com/data/discord-banners.json');
  assert.ok(banners.data.components);
  const pity = await send('{"type":2,"data":{"name":"гарант"},"user":{"id":"42"}}');
  assert.equal(pityId, '42');
  assert.match(pity.data.content, /Discord не привязан/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/index.ts';
import { createBuildsLoader, handleInteraction, verifyDiscordRequest } from '../src/lib/discord.ts';
import type { DiscordBuild } from '../src/lib/discord.ts';
import type { Env } from '../src/lib/env.ts';

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const keys = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return { pair, publicKey: hex(await crypto.subtle.exportKey('raw', pair.publicKey)) };
};
const sign = async (pair: CryptoKeyPair, timestamp: string, body: string) =>
  hex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(timestamp + body)));

const build: DiscordBuild = {
  s: 'aino', n: 'Айно', e: 'Aino', el: 'hydro', r: 4,
  i: 'https://genshinflex.com/img/aino.webp', url: '/characters/aino/',
  role: 'Поддержка', patch: '7.0',
  weapons: [{ n: 'Меч Фавония', note: 'а'.repeat(1200) }],
  artifacts: [{ n: 'Серенада шёлковой луны', note: '4 предмета' }],
  mainStats: { sands: 'Восст. энергии', goblet: 'Гидро урон', circlet: 'Крит. шанс' },
  substats: ['Восст. энергии', 'Крит. шанс'],
  teams: [{ name: 'Лунная команда', members: ['Цзы Бай', 'Айно'] }],
};
const deps = { loadBuilds: async () => [build], site: 'https://genshinflex.com' };

test('проверяет подпись Ed25519', async () => {
  const { pair, publicKey } = await keys();
  const timestamp = '123456';
  const body = '{"type":1}';
  const signature = await sign(pair, timestamp, body);
  assert.equal(await verifyDiscordRequest(publicKey, signature, timestamp, body), true);
  assert.equal(await verifyDiscordRequest(publicKey, signature, timestamp, '{}'), false);
  assert.equal(await verifyDiscordRequest((await keys()).publicKey, signature, timestamp, body), false);
  assert.equal(await verifyDiscordRequest('мусор', signature, timestamp, body), false);
  assert.equal(await verifyDiscordRequest(publicKey, 'мусор', timestamp, body), false);
});

test('отвечает на PING и подбирает персонажей', async () => {
  assert.deepEqual(await handleInteraction({ type: 1 }, deps), { type: 1 });
  const builds = [
    { ...build, s: 'leo', n: 'Леон', e: 'Leon' },
    { ...build, s: 'ezh', n: 'Ёж', e: 'Hedgehog' },
    { ...build, s: 'elena', n: 'Елена', e: 'Elena' },
  ];
  const complete = async (value: string) => (await handleInteraction({
    type: 4, data: { name: 'гайд', options: [{ name: 'персонаж', value, focused: true }] },
  }, { ...deps, loadBuilds: async () => builds })) as any;
  assert.deepEqual((await complete('е')).data.choices.map((item: { value: string }) => item.value), ['ezh', 'elena', 'leo']);
  assert.deepEqual((await complete('ле')).data.choices.map((item: { value: string }) => item.value), ['leo', 'elena']);
  assert.deepEqual((await complete('ЁЖ')).data.choices.map((item: { value: string }) => item.value), ['ezh']);
  assert.equal((await complete('')).data.choices.length, 3);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...build, s: String(i), n: `Имя ${i}` }));
  const limited = await handleInteraction({
    type: 4, data: { name: 'гайд', options: [{ name: 'персонаж', value: '' }] },
  }, { ...deps, loadBuilds: async () => many }) as any;
  assert.equal(limited.data.choices.length, 25);
  assert.deepEqual(await handleInteraction({ type: 4, data: { name: 'гайд' } }, {
    ...deps, loadBuilds: async () => { throw new Error('offline'); },
  }), { type: 8, data: { choices: [] } });
});

test('отдаёт гайд, ссылку и эфемерные ошибки', async () => {
  const command = (value: string) => ({ type: 2, data: { name: 'гайд', options: [{ name: 'персонаж', value }] } });
  const bySlug = await handleInteraction(command('aino'), deps) as any;
  const byName = await handleInteraction(command('АЙНО'), deps) as any;
  assert.equal(bySlug.type, 4);
  assert.deepEqual(byName.data.embeds, bySlug.data.embeds);
  assert.equal(bySlug.data.embeds[0].color, 0x4CC2F1);
  assert.equal(bySlug.data.embeds[0].title, 'Айно — гайд');
  assert.equal(bySlug.data.embeds[0].fields[0].name, 'Оружие');
  assert.equal(Array.from(bySlug.data.embeds[0].fields[0].value).length, 1024);
  assert.equal(bySlug.data.embeds[0].fields[0].value.endsWith('…'), true);
  assert.equal(bySlug.data.embeds[0].fields.length, 5);
  assert.deepEqual(bySlug.data.components, [{
    type: 1, components: [{ type: 2, style: 5, label: 'Открыть гайд на сайте', url: 'https://genshinflex.com/characters/aino/' }],
  }]);
  assert.equal((await handleInteraction(command('никого'), deps) as any).data.flags, 64);
  assert.deepEqual(await handleInteraction(command('aino'), {
    ...deps, loadBuilds: async () => { throw new Error('offline'); },
  }), { type: 4, data: { content: 'Гайды временно недоступны, попробуйте позже', flags: 64 } });
  assert.equal((await handleInteraction({ type: 2, data: { name: 'другое' } }, deps) as any).data.flags, 64);
});

test('маршрут требует подпись Discord', async () => {
  const { pair, publicKey } = await keys();
  const app = createApp({ discordBuilds: async () => [build] });
  const body = '{"type":1}';
  const timestamp = '123456';
  const env = { SITE_ORIGINS: '', DISCORD_PUBLIC_KEY: publicKey } as Env;
  const send = (headers: Record<string, string>, bindings = env) =>
    app.request('/discord/interactions', { method: 'POST', headers, body }, bindings);
  assert.equal((await send({})).status, 401);
  assert.equal((await send({}, { SITE_ORIGINS: '' } as Env)).status, 503);
  const response = await send({
    'X-Signature-Timestamp': timestamp,
    'X-Signature-Ed25519': await sign(pair, timestamp, body),
  });
  assert.deepEqual(await response.json(), { type: 1 });
});

test('загрузчик кэширует данные и отдаёт старые при ошибке', async () => {
  let calls = 0;
  let fail = false;
  const url = `https://example.com/${crypto.randomUUID()}`;
  const fetcher = (async () => {
    calls++;
    if (fail) throw new Error('offline');
    return Response.json({ builds: [build] });
  }) as typeof fetch;
  const load = createBuildsLoader(url, fetcher);
  assert.deepEqual(await load(), [build]);
  assert.deepEqual(await load(), [build]);
  assert.equal(calls, 1);
  const stale = createBuildsLoader(`${url}/stale`, fetcher, 0);
  assert.deepEqual(await stale(), [build]);
  fail = true;
  assert.deepEqual(await stale(), [build]);
  assert.equal(calls, 3);
});

test('ограничивает длину ответа и размер embed', async () => {
  const command = (value: string) => ({ type: 2, data: { name: 'гайд', options: [{ name: 'персонаж', value }] } });
  const value = 'Ж'.repeat(150);
  const missing = await handleInteraction(command(value), deps) as any;
  assert.equal(Array.from(missing.data.content.match(/«(.*)»/)?.[1] || '').length, 100);
  assert.match(missing.data.content, /…»/);
  const full = {
    ...build, role: 'Р'.repeat(4096),
    weapons: [{ n: 'О'.repeat(1200) }], artifacts: [{ n: 'А'.repeat(1200) }],
    mainStats: { sands: 'П'.repeat(1200), goblet: 'К', circlet: 'К' },
    substats: ['С'.repeat(1200)], teams: [{ name: 'Т'.repeat(1200), members: ['Айно'] }],
  };
  const embed = (await handleInteraction(command('aino'), { ...deps, loadBuilds: async () => [full] }) as any).data.embeds[0];
  const size = (item: any) => [item.title, item.description || '', item.footer.text,
    ...item.fields.flatMap((field: { name: string; value: string }) => [field.name, field.value])]
    .reduce((total: number, part: string) => total + Array.from(part).length, 0);
  assert.ok(size(embed) <= 6000);
  assert.ok(Array.from(embed.description).length < 4096);
  assert.equal(Array.from(embed.fields[4].value).length, 1024);
  const withoutRole = { ...full, role: undefined, patch: 'x'.repeat(2048) };
  const trimmed = (await handleInteraction(command('aino'), { ...deps, loadBuilds: async () => [withoutRole] }) as any).data.embeds[0];
  assert.ok(size(trimmed) <= 6000);
  assert.equal(Array.from(trimmed.fields[0].value).length, 1024);
  assert.ok(trimmed.fields.length < 5 || Array.from(trimmed.fields[4].value).length < 1024);
});

test('проверяет структуру данных и сохраняет старый кэш', async () => {
  let payload: unknown = { builds: [build] };
  const fetcher = (async () => Response.json(payload)) as typeof fetch;
  const url = `https://example.com/${crypto.randomUUID()}`;
  const load = createBuildsLoader(url, fetcher, 0);
  assert.deepEqual(await load(), [build]);
  payload = { builds: [{ ...build, weapons: [{ n: 5 }] }] };
  assert.deepEqual(await load(), [build]);
  const invalid = [
    { ...build, s: 5 },
    { ...build, artifacts: [{ n: 5 }] },
    { ...build, substats: [5] },
    { ...build, teams: [{ name: 'Команда', members: [5] }] },
  ];
  for (const [index, item] of invalid.entries()) {
    payload = { builds: [item] };
    await assert.rejects(createBuildsLoader(`${url}/${index}`, fetcher)(), /Неверные данные гайдов/);
  }
});

test('делит запрос между параллельными вызовами', async () => {
  let calls = 0;
  let finish!: (response: Response) => void;
  const fetcher = (async () => {
    calls++;
    return new Promise<Response>((resolve) => { finish = resolve; });
  }) as typeof fetch;
  const load = createBuildsLoader(`https://example.com/${crypto.randomUUID()}`, fetcher);
  const first = load();
  const second = load();
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(Response.json({ builds: [build] }));
  assert.deepEqual(await Promise.all([first, second]), [[build], [build]]);
});

test('прерывает зависший JSON и использует старый кэш', async () => {
  let hang = false;
  const signals: AbortSignal[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    if (!hang) return Response.json({ builds: [build] });
    signals.push(init?.signal as AbortSignal);
    return { ok: true, json: () => new Promise<unknown>(() => {}) } as unknown as Response;
  }) as typeof fetch;
  const url = `https://example.com/${crypto.randomUUID()}`;
  const stale = createBuildsLoader(url, fetcher, 0, 20);
  assert.deepEqual(await stale(), [build]);
  hang = true;
  const fresh = createBuildsLoader(`${url}/empty`, fetcher, 0, 20);
  const [oldResult, newResult] = await Promise.allSettled([stale(), fresh()]);
  assert.deepEqual(oldResult, { status: 'fulfilled', value: [build] });
  assert.equal(newResult.status, 'rejected');
  assert.deepEqual(signals.map((signal) => signal.aborted), [true, true]);
});

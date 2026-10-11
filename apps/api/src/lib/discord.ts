import type { PublicProfileCard } from './discord-profile.ts';
import { handleTicketInteraction, isTicketInteraction } from './discord-tickets.ts';
import { bannersReply, pityReply } from './discord-wishes.ts';
import type { TicketDeps } from './discord-tickets.ts';
import type { DiscordBannersData, PityData } from './discord-wishes.ts';

export type DiscordBuild = {
  s: string; n: string; e?: string; el?: string; r?: number; i?: string; url: string;
  role?: string; patch?: string; updated?: string;
  weapons?: { n: string; note?: string }[];
  artifacts?: { n: string; note?: string }[];
  mainStats?: { sands: string; goblet: string; circlet: string };
  substats?: string[];
  teams?: { name: string; members: string[] }[];
};

export type DiscordInteraction = {
  id?: string;
  token?: string;
  channel_id?: string;
  type: number;
  data?: {
    name?: string; custom_id?: string;
    options?: { name: string; value?: string; focused?: boolean }[];
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
  member?: { user?: { id: string }; roles?: string[]; permissions?: string };
  user?: { id: string };
};

export const colors: Record<string, number> = {
  pyro: 0xEF7938,
  hydro: 0x4CC2F1,
  anemo: 0x74C2A8,
  electro: 0xAF8EC1,
  dendro: 0xA5C83B,
  cryo: 0x9FD6E3,
  geo: 0xFAB632,
};

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('Неверный hex');
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function verifyDiscordRequest(
  publicKeyHex: string, signatureHex: string, timestamp: string, body: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', hexBytes(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hexBytes(signatureHex), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

const fold = (value: string | undefined) => (value || '').toLocaleLowerCase('ru').replaceAll('ё', 'е');
const length = (value: string) => Array.from(value).length;
const clip = (value: string, limit: number) => limit <= 0 ? '' : length(value) <= limit ? value : `${Array.from(value).slice(0, limit - 1).join('')}…`;
const unknownCommand = { type: 4, data: { content: 'Неизвестная команда', flags: 64 } };
const unavailable = { type: 4, data: { content: 'Гайды временно недоступны, попробуйте позже', flags: 64 } };
const profileUnavailable = { type: 4, data: { content: 'Профиль временно недоступен, попробуйте позже', flags: 64 } };
const bannersUnavailable = { type: 4, data: { content: 'Баннеры временно недоступны, попробуйте позже', flags: 64 } };
const pityUnavailable = { type: 4, data: { content: 'Гарант временно недоступен, попробуйте позже', flags: 64 } };

function fitEmbed(
  title: string, initialDescription: string, footer: string,
  fields: { name: string; value: string; inline: boolean }[], author = '',
) {
  let description = initialDescription;
  const size = () => length(author) + length(title) + length(description) + length(footer)
    + fields.reduce((total, field) => total + length(field.name) + length(field.value), 0);
  let excess = size() - 6000;
  if (excess > 0 && description) {
    description = clip(description, Math.max(0, length(description) - excess));
    excess = size() - 6000;
  }
  for (let i = fields.length - 1; i >= 0 && excess > 0; i--) {
    const field = fields[i];
    field.value = clip(field.value, Math.max(0, length(field.value) - excess));
    if (!field.value) fields.splice(i, 1);
    excess = size() - 6000;
  }
  return description;
}

function buildEmbed(build: DiscordBuild, site: string) {
  const url = `${site}${build.url}`;
  const title = clip(`${build.n} — гайд`, 256);
  const footer = clip(build.patch ? `GenshinFlex · патч ${build.patch}` : 'GenshinFlex', 2048);
  const initialDescription = build.role ? clip(build.role, 4096) : '';
  const fields: { name: string; value: string; inline: false }[] = [];
  const add = (name: string, value: string) => {
    if (value) fields.push({ name, value: clip(value, 1024), inline: false });
  };
  if (build.weapons?.length) add('Оружие', build.weapons.slice(0, 5).map((item, i) => `${i + 1}. ${item.n}${item.note ? ` — ${item.note}` : ''}`).join('\n'));
  if (build.artifacts?.length) add('Артефакты', build.artifacts.slice(0, 4).map((item, i) => `${i + 1}. ${item.n}${item.note ? ` — ${item.note}` : ''}`).join('\n'));
  if (build.mainStats) add('Основные статы', `Пески: ${build.mainStats.sands}\nКубок: ${build.mainStats.goblet}\nКорона: ${build.mainStats.circlet}`);
  if (build.substats?.length) add('Доп. статы', build.substats.join(' > '));
  if (build.teams?.length) add('Команды', build.teams.slice(0, 3).map((team) => `**${team.name}**: ${team.members.join(', ')}`).join('\n'));
  const description = fitEmbed(title, initialDescription, footer, fields);
  return {
    title,
    url, color: (build.el && Object.hasOwn(colors, build.el) ? colors[build.el] : undefined) ?? 0x5865F2,
    ...(build.i ? { thumbnail: { url: build.i } } : {}),
    ...(description ? { description } : {}),
    ...(fields.length ? { fields } : {}),
    footer: { text: footer },
  };
}

function profileEmbed(profile: PublicProfileCard, site: string) {
  const url = `${site}/u/${encodeURIComponent(profile.nickname)}/`;
  const author = clip(profile.name, 256);
  const title = clip(`@${profile.nickname}`, 256);
  const date = profile.createdAt ? new Date(profile.createdAt) : null;
  const footer = date && !Number.isNaN(date.getTime())
    ? `На GenshinFlex с ${date.toLocaleDateString('ru', { month: 'long', year: 'numeric' })}` : 'GenshinFlex';
  const fields: { name: string; value: string; inline: true }[] = [];
  const add = (name: string, value: string | undefined) => {
    if (value) fields.push({ name, value: clip(value, 1024), inline: true });
  };
  add('Титул', profile.title);
  add('Гильдия', profile.guild);
  if (profile.forum) add('Рейтинг форума',
    `${profile.forum.points} очк.${profile.forum.place ? ` · #${profile.forum.place}` : ''}`);
  if (profile.followers !== undefined) add('Подписчики', String(profile.followers));
  if (profile.listsHidden !== true && profile.friends !== undefined) add('Друзья', String(profile.friends));
  add('UID', profile.uid);
  fitEmbed(title, '', footer, fields, author);
  return {
    author: { name: author, ...(profile.avatar ? { icon_url: profile.avatar } : {}) },
    title, url, color: profile.color,
    ...(profile.avatar ? { thumbnail: { url: profile.avatar } } : {}),
    ...(fields.length ? { fields } : {}),
    footer: { text: footer },
  };
}

type InteractionDeps = {
  loadBuilds(): Promise<DiscordBuild[]>;
  site: string;
  loadProfile?(nickname: string, signal: AbortSignal, auxiliaryDeadline: number): Promise<PublicProfileCard | null>;
  findLinkedProfile?(discordId: string, signal: AbortSignal): Promise<{ nickname: string; is_public: boolean } | null>;
  loadBanners?(): Promise<DiscordBannersData>;
  loadPity?(discordId: string, signal: AbortSignal): Promise<PityData | null>;
  ticket?: TicketDeps;
};

export async function handleInteraction(
  interaction: DiscordInteraction, deps: InteractionDeps,
) {
  if (interaction.type === 1) return { type: 1 };
  if (isTicketInteraction(interaction)) return handleTicketInteraction(interaction, deps.ticket);
  if (interaction.type === 2 && interaction.data?.name === 'баннеры') {
    try {
      if (!deps.loadBanners) throw new Error('Нет загрузчика баннеров');
      return bannersReply(await deps.loadBanners(), deps.site, colors);
    } catch {
      return bannersUnavailable;
    }
  }
  if (interaction.type === 2 && interaction.data?.name === 'гарант') {
    const controller = new AbortController();
    const auxiliaryDeadline = Date.now() + 1_600;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const discordId = interaction.member?.user?.id ?? interaction.user?.id;
          if (!discordId || !deps.loadPity) throw new Error('Нет загрузчика гаранта');
          // Без данных баннеров счётчики всё равно показываем, только без строки про 50/50
          const standard = deps.loadBanners
            ? deps.loadBanners().then((data) => data.standard, () => null)
            : Promise.resolve(null);
          const pity = await deps.loadPity(discordId, controller.signal);
          if (!pity) return pityReply(null, null, deps.site);
          let wait: ReturnType<typeof setTimeout> | undefined;
          const late = new Promise<null>((resolve) => { wait = setTimeout(() => resolve(null), Math.max(0, auxiliaryDeadline - Date.now())); });
          try {
            return pityReply(pity, await Promise.race([standard, late]), deps.site);
          } finally {
            clearTimeout(wait);
          }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Превышено время загрузки гаранта'));
          }, 1_800);
        }),
      ]);
    } catch {
      return pityUnavailable;
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
  if (interaction.type === 2 && interaction.data?.name === 'профиль') {
    const controller = new AbortController();
    const auxiliaryDeadline = Date.now() + 1_600;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          if (!deps.loadProfile) throw new Error('Нет загрузчика профилей');
          const option = interaction.data?.options?.find((item) => item.name === 'ник');
          let nickname: string;
          if (option && typeof option.value === 'string') {
            nickname = option.value;
          } else {
            const discordId = interaction.member?.user?.id ?? interaction.user?.id;
            if (!discordId || !deps.findLinkedProfile) throw new Error('Нет привязки Discord');
            const linked = await deps.findLinkedProfile(discordId, controller.signal);
            if (!linked) return { type: 4, data: {
              content: `Discord не привязан к аккаунту GenshinFlex. Войдите на сайт через Discord или привяжите его в настройках: ${deps.site}/account/`,
              flags: 64,
            } };
            if (!linked.is_public) return { type: 4, data: {
              content: `Ваш профиль скрыт. Открыть его можно в настройках профиля: ${deps.site}/profile/`,
              flags: 64,
            } };
            nickname = linked.nickname;
          }
          const profile = await deps.loadProfile(nickname, controller.signal, auxiliaryDeadline);
          if (!profile) return { type: 4, data: {
            content: `Профиль «${clip(nickname, 100)}» не найден или скрыт.`, flags: 64,
          } };
          const url = `${deps.site}/u/${encodeURIComponent(profile.nickname)}/`;
          return { type: 4, data: {
            embeds: [profileEmbed(profile, deps.site)],
            components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Открыть профиль', url }] }],
          } };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Превышено время загрузки профиля'));
          }, 1_800);
        }),
      ]);
    } catch {
      return profileUnavailable;
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
  if (interaction.type === 4 && interaction.data?.name === 'гайд') {
    const option = interaction.data.options?.find((item) => item.name === 'персонаж');
    const query = fold(option?.value || '');
    try {
      const builds = [...await deps.loadBuilds()].sort((a, b) => a.n.localeCompare(b.n, 'ru'));
      const choices = builds.filter((build) => !query || [build.n, build.e, build.s].some((value) => fold(value).startsWith(query)));
      if (query) choices.push(...builds.filter((build) => !choices.includes(build) && [build.n, build.e, build.s].some((value) => fold(value).includes(query))));
      return { type: 8, data: { choices: choices.slice(0, 25).map((build) => ({ name: build.n, value: build.s })) } };
    } catch {
      return { type: 8, data: { choices: [] } };
    }
  }
  if (interaction.type !== 2 || interaction.data?.name !== 'гайд') return unknownCommand;
  const value = interaction.data.options?.find((item) => item.name === 'персонаж')?.value || '';
  let builds: DiscordBuild[];
  try {
    builds = await deps.loadBuilds();
  } catch {
    return unavailable;
  }
  const query = fold(value);
  const build = query && (builds.find((item) => fold(item.s) === query)
    || builds.find((item) => [item.n, item.e].some((name) => name && fold(name) === query))
    || (() => {
      const matches = builds.filter((item) => [item.n, item.e, item.s].some((name) => fold(name).includes(query)));
      return matches.length === 1 ? matches[0] : undefined;
    })());
  if (!build) return { type: 4, data: { content: `Не нашёл гайд для «${clip(value, 100)}». Начните вводить имя и выберите персонажа из списка.`, flags: 64 } };
  const url = `${deps.site}${build.url}`;
  return { type: 4, data: {
    embeds: [buildEmbed(build, deps.site)],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Открыть гайд на сайте', url }] }],
  } };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const named = (value: unknown) => isRecord(value) && typeof value.n === 'string' && optionalString(value.note);

function isDiscordBuild(value: unknown): value is DiscordBuild {
  if (!isRecord(value) || typeof value.s !== 'string' || typeof value.n !== 'string' || typeof value.url !== 'string') return false;
  if (![value.e, value.el, value.i, value.role, value.patch, value.updated].every(optionalString)) return false;
  if (value.r !== undefined && typeof value.r !== 'number') return false;
  if (value.weapons !== undefined && (!Array.isArray(value.weapons) || !value.weapons.every(named))) return false;
  if (value.artifacts !== undefined && (!Array.isArray(value.artifacts) || !value.artifacts.every(named))) return false;
  if (value.substats !== undefined && (!Array.isArray(value.substats) || !value.substats.every((item: unknown) => typeof item === 'string'))) return false;
  if (value.teams !== undefined && (!Array.isArray(value.teams) || !value.teams.every((item: unknown) =>
    isRecord(item) && typeof item.name === 'string' && Array.isArray(item.members)
      && item.members.every((member: unknown) => typeof member === 'string')))) return false;
  const stats = value.mainStats;
  if (stats !== undefined && (!isRecord(stats) || typeof stats.sands !== 'string'
    || typeof stats.goblet !== 'string' || typeof stats.circlet !== 'string')) return false;
  return true;
}

const cache = new Map<string, { data: unknown; expires: number }>();
const inFlight = new Map<string, Promise<unknown>>();

function parseBuilds(data: unknown): DiscordBuild[] {
  const builds = isRecord(data) ? data.builds : undefined;
  if (!Array.isArray(builds) || !builds.every(isDiscordBuild)) throw new Error('Неверные данные гайдов');
  return builds;
}

export function createBuildsLoader(url: string, fetchImpl: typeof fetch = fetch, ttlMs = 300_000, timeoutMs = 2_000) {
  return createJsonLoader(url, parseBuilds, fetchImpl, ttlMs, timeoutMs);
}

// Загрузчик JSON с сайта: кэш на ttlMs, общий запрос для параллельных вызовов, старый кэш при ошибке
export function createJsonLoader<T>(
  url: string, parse: (data: unknown) => T, fetchImpl: typeof fetch = fetch, ttlMs = 300_000, timeoutMs = 2_000,
) {
  return (): Promise<T> => {
    const cached = cache.get(url);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.data as T);
    const running = inFlight.get(url);
    if (running) return running as Promise<T>;
    const pending = Promise.resolve().then(async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const data: unknown = await Promise.race([
          (async () => {
            const response = await fetchImpl(url, {
              cf: { cacheTtl: 300 }, signal: controller.signal,
            } as RequestInit & { cf: { cacheTtl: number } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error(`Превышено время загрузки ${url}`));
            }, timeoutMs);
          }),
        ]);
        const parsed = parse(data);
        cache.set(url, { data: parsed, expires: Date.now() + ttlMs });
        return parsed;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }).catch((error) => {
      const stale = cache.get(url);
      if (stale) return stale.data as T;
      throw error;
    }).finally(() => {
      inFlight.delete(url);
    });
    inFlight.set(url, pending);
    return pending;
  };
}

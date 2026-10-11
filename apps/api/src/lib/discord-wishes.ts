// Команды /баннеры и /гарант. Данные баннеров — https://genshinflex.com/data/discord-banners.json,
// счётчики гаранта — RPC discord_wish_pity (миграция 20261011122330).

export type DiscordBanner = {
  version: string; phase: number; start: string; end: string;
  featured: { s: string; n: string; el?: string; i?: string; rerun?: boolean }[];
  fourStars: string[]; weapons: string[];
};
export type DiscordBannersData = { banners: DiscordBanner[]; standard: { id: string | null; names: string[] }[] };

export type PityGroup = {
  key: 'char' | 'weapon' | 'standard' | 'chronicled';
  total: number; p5: number; p4: number;
  last5_name: string | null; last5_item_id: string | null;
};
export type PityData = { uids: { game_uid: string; groups: PityGroup[] }[] };

const GOLD = 0xD3BC8E;
const length = (value: string) => Array.from(value).length;
const clip = (value: string, limit: number) => length(value) <= limit ? value : `${Array.from(value).slice(0, limit - 1).join('')}…`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const serverTimeRe = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

// «2026-10-13T18:00» по времени сервера Европы (UTC+1) → момент в UTC, как serverMoment в src/scripts/common.ts
export function serverMoment(value: string): number {
  const match = serverTimeRe.exec(value);
  if (!match) return Number.NaN;
  const [, y, m, d, h, min] = match.map(Number);
  return Date.UTC(y, m - 1, d, h - 1, min);
}

function isBanner(value: unknown): value is DiscordBanner {
  if (!isRecord(value) || typeof value.version !== 'string' || typeof value.phase !== 'number') return false;
  if (typeof value.start !== 'string' || typeof value.end !== 'string') return false;
  if (Number.isNaN(serverMoment(value.start)) || Number.isNaN(serverMoment(value.end))) return false;
  if (!strings(value.fourStars) || !strings(value.weapons) || !Array.isArray(value.featured)) return false;
  return value.featured.every((item: unknown) => isRecord(item) && typeof item.s === 'string' && typeof item.n === 'string'
    && [item.el, item.i].every((field) => field === undefined || typeof field === 'string')
    && (item.rerun === undefined || typeof item.rerun === 'boolean'));
}

export function parseBannersData(data: unknown): DiscordBannersData {
  if (!isRecord(data) || !Array.isArray(data.banners) || !Array.isArray(data.standard)) throw new Error('Неверные данные баннеров');
  return {
    banners: data.banners.filter(isBanner),
    standard: data.standard.filter((item): item is DiscordBannersData['standard'][number] =>
      isRecord(item) && (item.id === null || typeof item.id === 'string') && strings(item.names)),
  };
}

const unix = (ms: number) => Math.floor(ms / 1000);
const featuredLine = (banner: DiscordBanner) => banner.featured.map((item) => `${item.n}${item.rerun ? ' (повтор)' : ''}`).join(', ');

export function bannersReply(data: DiscordBannersData, site: string, colors: Record<string, number>, now = Date.now()) {
  const sorted = [...data.banners].sort((a, b) => serverMoment(a.start) - serverMoment(b.start));
  const current = sorted.filter((item) => serverMoment(item.start) <= now && now < serverMoment(item.end));
  const next = sorted.find((item) => serverMoment(item.start) > now);
  const nextLine = next && `${featuredLine(next) || `Молитвы ${next.version}, фаза ${next.phase}`} — старт <t:${unix(serverMoment(next.start))}:R>`;
  const components = [{ type: 1, components: [{ type: 2, style: 5, label: 'Все баннеры', url: `${site}/banners/` }] }];
  if (!current.length) {
    const content = nextLine ? `Сейчас баннеры не идут. Дальше: ${nextLine}` : 'Данных о баннерах пока нет';
    return { type: 4, data: { content: clip(content, 2000), components } };
  }
  const embeds = current.slice(0, 5).map((banner, index) => {
    const end = unix(serverMoment(banner.end));
    const lines = [
      banner.featured.length ? `★5: ${featuredLine(banner)}` : '',
      banner.fourStars.length ? `★4: ${banner.fourStars.join(', ')}` : '',
      banner.weapons.length ? `Оружие: ${banner.weapons.join(', ')}` : '',
      `Конец: <t:${end}:f> (<t:${end}:R>)`,
    ].filter(Boolean);
    const first = banner.featured[0];
    const color = (first?.el && Object.hasOwn(colors, first.el) ? colors[first.el] : undefined) ?? GOLD;
    const last = index === Math.min(current.length, 5) - 1;
    return {
      title: clip(`Молитвы ${banner.version}, фаза ${banner.phase}`, 256),
      url: `${site}/banners/`,
      description: clip(lines.join('\n'), 4096),
      color,
      ...(first?.i ? { thumbnail: { url: first.i } } : {}),
      ...(last && nextLine ? { fields: [{ name: 'Дальше', value: clip(nextLine, 1024), inline: false }] } : {}),
      footer: { text: 'Время сервера Европы (UTC+1)' },
    };
  });
  return { type: 4, data: { embeds, components } };
}

export function isPityData(value: unknown): value is PityData {
  return isRecord(value) && Array.isArray(value.uids) && value.uids.every((uid: unknown) =>
    isRecord(uid) && typeof uid.game_uid === 'string' && Array.isArray(uid.groups) && uid.groups.every((group: unknown) =>
      isRecord(group) && ['char', 'weapon', 'standard', 'chronicled'].includes(group.key as string)
      && [group.total, group.p5, group.p4].every((n) => typeof n === 'number')
      && [group.last5_name, group.last5_item_id].every((field) => field === null || field === undefined || typeof field === 'string')));
}

const GROUPS: Record<PityGroup['key'], { title: string; pity: number; soft: number }> = {
  char: { title: 'Событие персонажа', pity: 90, soft: 74 },
  weapon: { title: 'Оружие', pity: 80, soft: 63 },
  standard: { title: 'Стандартный', pity: 90, soft: 74 },
  chronicled: { title: 'Хроники', pity: 90, soft: 74 },
};
const ORDER: PityGroup['key'][] = ['char', 'weapon', 'standard', 'chronicled'];

function lostFiftyFifty(group: PityGroup, standard: DiscordBannersData['standard']): boolean {
  const id = group.last5_item_id || null;
  const name = group.last5_name?.trim().toLowerCase();
  if (!id && !name) return false;
  return standard.some((item) => (id !== null && item.id === id) || (!!name && item.names.includes(name)));
}

function groupLine(group: PityGroup, standard: DiscordBannersData['standard'] | null): string {
  const meta = GROUPS[group.key];
  let line = `${meta.title}: **${group.p5}**/${meta.pity} · 4★ ${group.p4}/10`;
  if (group.key === 'char' && standard) {
    line += lostFiftyFifty(group, standard) ? ' · следующий 5★ — гарантированно лимитный' : ' · 50/50';
  }
  if (group.p5 >= meta.soft) line += ' · мягкий гарант';
  return line;
}

export function pityReply(pity: PityData | null, standard: DiscordBannersData['standard'] | null, site: string) {
  if (!pity) return { type: 4, data: {
    content: `Discord не привязан к аккаунту GenshinFlex. Войдите на сайт через Discord или привяжите его в настройках: ${site}/account/`,
    flags: 64,
  } };
  const url = `${site}/tools/wishes/`;
  const uids = pity.uids.filter((uid) => uid.groups.length);
  if (!uids.length) return { type: 4, data: {
    content: `История молитв не загружена. Загрузите её на ${url} — счётчики гаранта появятся здесь.`,
    flags: 64,
  } };
  const fields = uids.slice(0, 3).map((uid) => ({
    name: uid.game_uid === 'manual' ? 'Ручной ввод' : clip(`UID ${uid.game_uid}`, 256),
    value: clip(ORDER.flatMap((key) => uid.groups.filter((group) => group.key === key)).map((group) => groupLine(group, standard)).join('\n'), 1024),
    inline: false,
  }));
  return { type: 4, data: {
    embeds: [{ title: 'Гарант молитв', url, color: GOLD, fields, footer: { text: 'GenshinFlex' } }],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'История молитв', url }] }],
    flags: 64,
  } };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { colors } from './discord.ts';

export type PublicProfileCard = {
  nickname: string;
  name: string;
  createdAt?: string;
  avatar?: string;
  color: number;
  title?: string;
  guild?: string;
  forum?: { points: number; place?: number };
  followers?: number;
  friends?: number;
  listsHidden?: boolean;
  uid?: string;
};

export type PublicProfileClient = Pick<SupabaseClient, 'from' | 'rpc' | 'storage'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const first = (value: unknown): unknown => Array.isArray(value) ? value[0] : value;
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const optional = async <T>(load: () => Promise<T>, cutoff: Promise<null>): Promise<T | null> => {
  try { return await Promise.race([load(), cutoff]); } catch { return null; }
};

const characterCache = new Map<string, { icons: Map<string, string>; expires: number }>();
const characterInFlight = new Map<string, Promise<Map<string, string>>>();

function loadCharacterIcons(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Map<string, string>> {
  if (signal?.aborted) return Promise.reject(new Error('Загрузка персонажей отменена'));
  const cached = characterCache.get(url);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.icons);
  const running = signal ? undefined : characterInFlight.get(url);
  if (running) return running;
  const pending = Promise.resolve().then(async () => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
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
            reject(new Error('Превышено время загрузки персонажей'));
          }, 1_500);
        }),
      ]);
      if (!isRecord(data) || !Array.isArray(data.characters)) throw new Error('Неверные данные персонажей');
      const icons = new Map<string, string>();
      for (const character of data.characters) {
        if (isRecord(character) && typeof character.s === 'string' && typeof character.i === 'string') {
          icons.set(character.s, character.i);
        }
      }
      characterCache.set(url, { icons, expires: Date.now() + 300_000 });
      return icons;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }).catch((error) => {
    const stale = characterCache.get(url);
    if (stale) return stale.icons;
    throw error;
  }).finally(() => {
    if (!signal) characterInFlight.delete(url);
  });
  if (!signal) characterInFlight.set(url, pending);
  return pending;
}

export async function loadDiscordProfile(
  client: PublicProfileClient, nickname: string, site: string, fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal, auxiliaryDeadline = Date.now() + 1_500,
): Promise<PublicProfileCard | null> {
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(nickname)) return null;
  const query = client.from('public_profiles')
    .select('id,nickname,display_name,created_at,active_title,custom').eq('nickname', nickname);
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!isRecord(data) || typeof data.id !== 'string' || typeof data.nickname !== 'string') {
    throw new Error('Неверные данные профиля');
  }

  const custom = isRecord(data.custom) ? data.custom : {};
  const appearance = isRecord(custom.avatar) ? custom.avatar : {};
  const media = isRecord(custom.media) ? custom.media : {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, auxiliaryDeadline - Date.now()));
  });
  const rpc = (name: 'guild_of' | 'forum_user_score' | 'social_counts', p_user: string) => {
    const request = client.rpc(name, { p_user });
    return signal ? request.abortSignal(signal) : request;
  };
  const [titleResult, guildResult, forumResult, socialResult, extrasResult, characterResult] = await Promise.all([
    data.active_title && typeof data.active_title === 'string'
      ? optional(async () => {
        const request = client.from('titles').select('name_ru,color').eq('id', data.active_title);
        return (signal ? request.abortSignal(signal) : request).maybeSingle();
      }, cutoff)
      : Promise.resolve(null),
    optional(async () => rpc('guild_of', data.id), cutoff),
    optional(async () => rpc('forum_user_score', data.id), cutoff),
    optional(async () => rpc('social_counts', data.id), cutoff),
    optional(async () => {
      const request = client.rpc('public_profile_extras', { p_nickname: data.nickname });
      return signal ? request.abortSignal(signal) : request;
    }, cutoff),
    appearance.type === 'character' && typeof appearance.slug === 'string'
      ? optional(() => loadCharacterIcons(`${site}/data/index.json`, fetchImpl, signal), cutoff)
      : Promise.resolve(null),
  ]);
  if (timer) clearTimeout(timer);

  const title = titleResult && !titleResult.error ? first(titleResult.data) : null;
  const guild = guildResult && !guildResult.error ? first(guildResult.data) : null;
  const forum = forumResult && !forumResult.error ? first(forumResult.data) : null;
  const social = socialResult && !socialResult.error ? first(socialResult.data) : null;
  const extras = extrasResult && !extrasResult.error ? first(extrasResult.data) : null;
  const card: PublicProfileCard = {
    nickname: data.nickname,
    name: typeof custom.nick === 'string' && custom.nick.trim()
      ? custom.nick.trim()
      : typeof data.display_name === 'string' && data.display_name
        ? data.display_name : data.nickname,
    color: typeof custom.color === 'string' && Object.hasOwn(colors, custom.color)
      ? colors[custom.color]
      : typeof custom.color === 'string' && /^#[0-9a-f]{6}$/i.test(custom.color)
        ? Number.parseInt(custom.color.slice(1), 16) : 0xD3BC8E,
  };
  if (typeof data.created_at === 'string') card.createdAt = data.created_at;
  if (appearance.type === 'upload' && typeof media.avatar === 'string' && media.avatar) {
    card.avatar = client.storage.from('profile-media')
      .getPublicUrl(`${encodeURIComponent(data.id)}/avatar-${encodeURIComponent(media.avatar)}`).data.publicUrl;
  } else if (appearance.type === 'character' && typeof appearance.slug === 'string' && characterResult) {
    const icon = characterResult.get(appearance.slug);
    if (icon) {
      try {
        const url = new URL(icon, `${site}/`);
        if (url.protocol === 'https:' || url.protocol === 'http:') card.avatar = url.href;
      } catch { /* Некорректная иконка не влияет на профиль */ }
    }
  }
  if (isRecord(title) && typeof title.name_ru === 'string' && title.name_ru) card.title = title.name_ru;
  if (isRecord(guild) && typeof guild.tag === 'string' && typeof guild.name === 'string') {
    card.guild = `[${guild.tag}] ${guild.name}`;
  }
  if (isRecord(forum)) {
    const points = count(forum.points);
    const place = count(forum.place);
    if (points !== undefined && points > 0) card.forum = { points, ...(place ? { place } : {}) };
  }
  if (isRecord(social)) {
    card.followers = count(social.followers);
    card.listsHidden = social.lists_hidden === true;
    if (!card.listsHidden) card.friends = count(social.friends);
  }
  if (isRecord(extras) && typeof extras.uid === 'string' && /^\d{9,10}$/.test(extras.uid)) {
    card.uid = extras.uid;
  }
  return card;
}

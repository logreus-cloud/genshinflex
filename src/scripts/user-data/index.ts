import type { Entry } from '../common';
import { hasSession } from './session';

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
export type Lang = 'ru' | 'en' | 'es';
export type Kind = 'custom' | 'data';
type Values = {
  favorites: Entry[];
  roster: Record<string, unknown>[];
  profileUid: string | null;
  profileCustom: Record<string, unknown>;
};
type Key = keyof Values;
export type UserDataWrite = { [K in Key]: [K, Values[K], Lang?] }[Key];

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const registry = {
  favorites: {
    key: (lang: Lang) => lang === 'ru' ? 'gf:favs' : `gf:favs:${lang}`,
    kind: 'data',
    fallback: () => [] as Entry[],
    valid: (value: unknown): value is Entry[] => Array.isArray(value) && value.every((item) => record(item) &&
      typeof item.href === 'string' && typeof item.name === 'string' && typeof item.kind === 'string' &&
      (item.icon === undefined || item.icon === null || typeof item.icon === 'string')),
  },
  roster: {
    key: () => 'gf:roster',
    kind: 'data',
    fallback: () => [] as Record<string, unknown>[],
    valid: (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) &&
      value.every((item) => record(item) && typeof item.s === 'string'),
  },
  profileUid: {
    key: () => 'gf:profile-uid',
    kind: 'data',
    fallback: () => null as string | null,
    valid: (value: unknown): value is string | null => value === null || typeof value === 'string' && /^\d{9,10}$/.test(value),
  },
  profileCustom: {
    key: () => 'gf:profile-custom',
    kind: 'custom',
    fallback: () => ({} as Record<string, unknown>),
    valid: record,
  },
} as const;
const browserStorage: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

type Listener = (value: unknown, lang: Lang) => void;
const subscribers = new WeakMap<KeyValueStorage, Map<Key, Set<Listener>>>();
function notifySubscribers(storage: KeyValueStorage, key: Key, value: unknown, lang: Lang, path: string, raw: string | null) {
  for (const listener of subscribers.get(storage)?.get(key) ?? []) {
    try { if (storage.getItem(path) !== raw) break; } catch { break; }
    try { listener(value, lang); } catch {}
  }
}

export function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

export function userDataKey(key: Key, lang: Lang = 'ru'): string {
  return registry[key].key(lang);
}

export function clearUserData(storage: KeyValueStorage = browserStorage) {
  const entries: [Key, Lang][] = [
    ['favorites', 'ru'], ['favorites', 'en'], ['favorites', 'es'],
    ['roster', 'ru'], ['profileUid', 'ru'], ['profileCustom', 'ru'],
  ];
  const removed: [Key, Lang, string][] = [];
  for (const [key, lang] of entries) {
    const path = userDataKey(key, lang);
    if (storage.getItem(path) === null) continue;
    storage.removeItem(path);
    removed.push([key, lang, path]);
  }
  for (const [key, lang, path] of removed) {
    notifySubscribers(storage, key, registry[key].fallback(), lang, path, null);
  }
}

export function validUserData<K extends Key>(key: K, value: unknown): value is Values[K] {
  return registry[key].valid(value);
}

export function readStrict<K extends Key>(key: K, lang: Lang = 'ru', storage: KeyValueStorage = browserStorage): Values[K] {
  const raw = storage.getItem(userDataKey(key, lang));
  if (raw === null) return registry[key].fallback() as Values[K];
  const value: unknown = JSON.parse(raw);
  if (!validUserData(key, value)) throw new Error('Invalid stored profile data');
  return value;
}

function serializeValue<K extends Key>(key: K, value: Values[K]): { raw: string; value: Values[K] } | null {
  try {
    if (!validUserData(key, value)) return null;
    const raw = JSON.stringify(value);
    if (typeof raw !== 'string') return null;
    const parsed: unknown = JSON.parse(raw);
    return validUserData(key, parsed) ? { raw, value: parsed } : null;
  } catch { return null; }
}

export function hasStoredUserData(kind: Kind, storage: KeyValueStorage = browserStorage): boolean {
  const keys = kind === 'custom' ? [userDataKey('profileCustom')] : [
    userDataKey('favorites'), userDataKey('favorites', 'en'), userDataKey('favorites', 'es'),
    userDataKey('roster'), userDataKey('profileUid'),
  ];
  return keys.some((key) => storage.getItem(key) !== null);
}

function updateMarker(kind: Kind | readonly Kind[], storage: KeyValueStorage): boolean {
  try {
    const kinds = typeof kind === 'string' ? [kind] : kind;
    let value: unknown;
    try { value = JSON.parse(storage.getItem('gf:sync') || 'null'); } catch { value = null; }
    const marker = record(value) ? value : {};
    // Каждый вид — от собственной отметки: synced сохраняется, at растёт монотонно
    const next = (current: Kind) => {
      const previous = record(marker[current]) ? marker[current] : {};
      const at = typeof previous.at === 'number' && Number.isFinite(previous.at) && previous.at >= 0 ? previous.at : 0;
      const synced = typeof previous.synced === 'number' && Number.isFinite(previous.synced) && previous.synced >= 0 ? previous.synced : 0;
      return kinds.includes(current) ? { at: Math.max(Date.now(), at + 1, synced + 1), synced } : marker[current] ?? { at: 0, synced: 0 };
    };
    storage.setItem('gf:sync', JSON.stringify({
      ...marker,
      user: typeof marker.user === 'string' ? marker.user : '',
      custom: next('custom'),
      data: next('data'),
    }));
    return true;
  } catch { return false; }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let scheduled = 0;
function scheduleSync() {
  if (!hasSession()) return;
  cancelScheduledSync();
  const turn = scheduled;
  timer = setTimeout(async () => {
    timer = undefined;
    if (!hasSession()) return;
    const { syncNow } = await import('../profile-sync');
    if (turn === scheduled && hasSession()) void syncNow();
  }, 1500);
}

export function cancelScheduledSync() {
  scheduled++;
  clearTimeout(timer);
  timer = undefined;
}

export function markChanged(kind: Kind) {
  if (updateMarker(kind, browserStorage)) scheduleSync();
}

export function createUserData({ storage = browserStorage, onChanged }: {
  storage?: KeyValueStorage;
  onChanged?: (kind: Kind) => void;
} = {}) {
  return {
    get<K extends Key>(key: K, lang: Lang = 'ru'): Values[K] {
      try { return readStrict(key, lang, storage); }
      catch { return registry[key].fallback() as Values[K]; }
    },
    readStrict<K extends Key>(key: K, lang: Lang = 'ru'): Values[K] {
      return readStrict(key, lang, storage);
    },
    set<K extends Key>(key: K, value: Values[K], lang: Lang = 'ru'): boolean {
      const serialized = serializeValue(key, value);
      if (!serialized) return false;
      const path = userDataKey(key, lang);
      let previous: string | null;
      try { previous = storage.getItem(path); } catch { return false; }
      try {
        storage.setItem(path, serialized.raw);
        if (!updateMarker(registry[key].kind, storage)) throw new Error('Could not update sync marker');
      } catch {
        try {
          if (previous === null) storage.removeItem(path);
          else storage.setItem(path, previous);
        } catch {}
        return false;
      }
      notifySubscribers(storage, key, serialized.value, lang, path, serialized.raw);
      try { onChanged?.(registry[key].kind); } catch {}
      return true;
    },
    snapshot(): { favorites: Record<Lang, Entry[]>; roster: Record<string, unknown>[]; profileUid: string | null; damaged: boolean } {
      let damaged = false;
      const list = <K extends 'favorites' | 'roster'>(key: K, lang: Lang = 'ru'): Values[K] => {
        let value: unknown;
        try {
          const raw = storage.getItem(userDataKey(key, lang));
          if (raw === null) return registry[key].fallback() as Values[K];
          value = JSON.parse(raw);
        } catch { damaged = true; return registry[key].fallback() as Values[K]; }
        if (!Array.isArray(value)) { damaged = true; return registry[key].fallback() as Values[K]; }
        const filtered = value.filter((item) => validUserData(key, [item])) as Values[K];
        if (filtered.length !== value.length) damaged = true;
        return filtered;
      };
      let profileUid: string | null = null;
      try {
        const raw = storage.getItem(userDataKey('profileUid'));
        if (raw !== null) {
          const value: unknown = JSON.parse(raw);
          if (validUserData('profileUid', value)) profileUid = value;
          else damaged = true;
        }
      } catch { damaged = true; }
      return {
        favorites: { ru: list('favorites'), en: list('favorites', 'en'), es: list('favorites', 'es') },
        roster: list('roster'), profileUid, damaged,
      };
    },
    restore(data: { favorites: Partial<Record<Lang, Entry[]>>; roster: Record<string, unknown>[]; profileUid: string | null; profileCustom?: Record<string, unknown> }): boolean {
      const entries = new Map<string, { key: Key; lang: Lang; raw: string; value: unknown }>();
      try {
        if (!record(data) || !record(data.favorites) ||
          Object.keys(data.favorites).some((lang) => !['ru', 'en', 'es'].includes(lang))) return false;
        const add = <K extends Key>(key: K, value: Values[K], lang: Lang = 'ru') => {
          const serialized = serializeValue(key, value);
          if (!serialized) return false;
          entries.set(userDataKey(key, lang), { key, lang, ...serialized });
          return true;
        };
        for (const lang of ['ru', 'en', 'es'] as const) {
          if (Object.prototype.hasOwnProperty.call(data.favorites, lang) && !add('favorites', data.favorites[lang]!, lang)) return false;
        }
        if (!add('roster', data.roster) || !add('profileUid', data.profileUid)) return false;
        if (Object.prototype.hasOwnProperty.call(data, 'profileCustom') && !add('profileCustom', data.profileCustom!)) return false;
      } catch {
        return false;
      }
      let previous: (readonly [string, string | null])[];
      try { previous = [...entries.keys(), 'gf:sync'].map((path) => [path, storage.getItem(path)] as const); }
      catch { return false; }
      const original = new Map(previous);
      const written: string[] = [];
      const kinds: Kind[] = ['data'];
      if (entries.has(userDataKey('profileCustom'))) kinds.push('custom');
      try {
        for (const [path, entry] of entries) {
          storage.setItem(path, entry.raw);
          written.push(path);
        }
        if (!updateMarker(kinds, storage)) throw new Error('Could not update sync marker');
        written.push('gf:sync');
      } catch {
        for (const path of written.reverse()) try {
          const value = original.get(path);
          if (value == null) storage.removeItem(path);
          else storage.setItem(path, value);
        } catch {}
        return false;
      }
      for (const [path, value] of previous) {
        const entry = entries.get(path);
        if (entry && value !== entry.raw) {
          notifySubscribers(storage, entry.key, entry.value, entry.lang, path, entry.raw);
        }
      }
      for (const kind of kinds) try { onChanged?.(kind); } catch {}
      return true;
    },
    toolUid(own: unknown): string {
      if (validUserData('profileUid', own) && own !== null) return own;
      try { return readStrict('profileUid', 'ru', storage) ?? ''; } catch { return ''; }
    },
    subscribe<K extends Key>(key: K, listener: (value: Values[K], lang: Lang) => void): () => void {
      const listeners = subscribers.get(storage) ?? new Map<Key, Set<Listener>>();
      const group = listeners.get(key) ?? new Set<Listener>();
      group.add(listener as Listener);
      listeners.set(key, group);
      subscribers.set(storage, listeners);
      return () => { group.delete(listener as Listener); };
    },
  };
}

export function writePulled(writes: UserDataWrite[], storage: KeyValueStorage = browserStorage) {
  const entries = new Map<string, { key: Key; lang: Lang; raw: string; value: unknown }>();
  for (const [key, value, lang] of writes) {
    const serialized = serializeValue(key, value);
    if (!serialized) throw new Error('Invalid profile data');
    const language = lang ?? 'ru';
    entries.set(userDataKey(key, language), { key, lang: language, ...serialized });
  }
  const previous = [...entries.keys()].map((path) => [path, storage.getItem(path)] as const);
  const original = new Map(previous);
  const written: string[] = [];
  try {
    for (const [path, entry] of entries) {
      storage.setItem(path, entry.raw);
      written.push(path);
    }
  } catch (error) {
    for (const path of written.reverse()) try {
      const value = original.get(path);
      if (value == null) storage.removeItem(path);
      else storage.setItem(path, value);
    } catch {}
    throw error;
  }
  for (const [path, value] of previous) {
    const entry = entries.get(path)!;
    if (value !== entry.raw) {
      notifySubscribers(storage, entry.key, entry.value, entry.lang, path, entry.raw);
    }
  }
}

export const userData = createUserData({ onChanged: scheduleSync });

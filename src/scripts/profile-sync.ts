import { getMedia, type MediaKey } from './profile-media';
import { hasSession, onSessionChange } from './user-data/session';
import { cancelScheduledSync, hasStoredUserData, readStrict, userDataKey, validUserData, writePulled, type Kind, type UserDataWrite } from './user-data';
import type { Entry } from './common';
export { markChanged } from './user-data';

type Result = 'pulled' | 'pushed' | 'same' | 'skipped';
export type SyncResult = Record<Kind, Result>;
type Stamp = { at: number; synced: number };
type Marker = { user: string; custom: Stamp; data: Stamp };
type Payload = { favorites: Record<'ru' | 'en' | 'es', Entry[]>; roster: Record<string, unknown>[]; settings: { uid: string | null } };
type Client = ReturnType<typeof import('./auth')['getSupabase']>;
type Bucket = ReturnType<Client['storage']['from']>;

const mediaKeys: MediaKey[] = ['avatar', 'cover', 'background'];
const langs = ['ru', 'en', 'es'] as const;
const blank = (): SyncResult => ({ custom: 'skipped', data: 'skipped' });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

function readMarker(user: string): Marker {
  let value: unknown;
  try { value = JSON.parse(localStorage.getItem('gf:sync') || 'null'); } catch { value = null; }
  if (record(value) && value.user === user && record(value.custom) && record(value.data) &&
    [value.custom.at, value.custom.synced, value.data.at, value.data.synced].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return value as unknown as Marker;
  const at = (kind: Kind) => {
    const stamp = record(value) ? value[kind] : null;
    return record(stamp) && typeof stamp.at === 'number' && Number.isFinite(stamp.at) && stamp.at >= 0 ? stamp.at : 0;
  };
  return { user, custom: { at: at('custom'), synced: 0 }, data: { at: at('data'), synced: 0 } };
}
function saveMarker(value: Marker) { localStorage.setItem('gf:sync', JSON.stringify(value)); }
function finish(user: string, kind: Kind, before: number, synced: number, active: () => boolean, pulled = false) {
  if (!active()) return;
  let value: unknown;
  try { value = JSON.parse(localStorage.getItem('gf:sync') || 'null'); } catch { return; }
  if (!record(value) || value.user !== user) return;
  const current = readMarker(user);
  current[kind].at = current[kind].at === before ? (pulled ? synced : Math.min(before, synced)) : Math.max(current[kind].at, synced + 1);
  current[kind].synced = synced;
  if (active()) saveMarker(current);
}
function stable(user: string, kind: Kind, before: number) {
  let value: unknown;
  try { value = JSON.parse(localStorage.getItem('gf:sync') || 'null'); } catch { return false; }
  return record(value) && value.user === user && record(value[kind]) && value[kind].at === before;
}

function localData(): Payload {
  const favorites = Object.fromEntries(langs.map((lang) => [lang, readStrict('favorites', lang)])) as Payload['favorites'];
  const roster = readStrict('roster');
  const uid = readStrict('profileUid');
  return { favorites, roster, settings: { uid } };
}
function cloudData(row: unknown): Payload | null {
  if (!record(row)) return null;
  const favorites = row.favorites, roster = row.roster, settings = row.settings;
  if (!(record(favorites) && langs.some((lang) => Array.isArray(favorites[lang])) || Array.isArray(roster) && roster.length > 0 || record(settings) && 'uid' in settings)) return null;
  if (!record(favorites) || !langs.every((lang) => validUserData('favorites', favorites[lang])) || !validUserData('roster', roster) || !record(settings) || !validUserData('profileUid', settings.uid)) throw new Error('Invalid cloud profile data');
  return { favorites: favorites as Payload['favorites'], roster, settings: { uid: settings.uid } };
}

function commitPulledMedia(key: MediaKey, blob: Blob, version: string, active: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (!active()) return resolve(false);
      const request = indexedDB.open('gf-profile', 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!active()) return request.transaction?.abort();
        if (!request.result.objectStoreNames.contains('media')) request.result.createObjectStore('media');
      };
      request.onerror = () => resolve(false);
      request.onblocked = () => { blocked = true; resolve(false); };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked || !active()) { db.close(); return resolve(false); }
        try {
          const tx = db.transaction('media', 'readwrite');
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = tx.onabort = () => { db.close(); resolve(false); };
          if (!active()) return tx.abort();
          tx.objectStore('media').put(blob, `${key}@${version}`);
        } catch { db.close(); resolve(false); }
      };
    } catch { resolve(false); }
  });
}

function mediaOf(custom: unknown): Partial<Record<MediaKey, string>> {
  if (!record(custom) || custom.v !== 1) throw new Error('Invalid profile customization');
  const versions: Partial<Record<MediaKey, string>> = {};
  const media = record(custom.media) ? custom.media : {};
  for (const key of mediaKeys) {
    const used = key === 'avatar' ? record(custom.avatar) && custom.avatar.type === 'upload' : key === 'cover' ? custom.coverType === 'upload' : record(custom.background) && custom.background.type === 'upload';
    if (!used) continue;
    const version = media[key];
    if (typeof version !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(version)) throw new Error('Invalid media version');
    versions[key] = version;
  }
  return versions;
}
async function names(bucket: Bucket, id: string) {
  const names: { name: string; created_at: string }[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await bucket.list(id, { limit: 100, offset });
    if (error || !data) throw new Error('Media listing failed');
    names.push(...data.filter((item) => !!item.id).map((item) => ({ name: item.name, created_at: item.created_at })));
    if (data.length < 100) break;
  }
  return names;
}
function choose(local: boolean, remote: boolean, stamp: Stamp, remoteAt: number) {
  if (!remote) return local ? 'push' : 'same';
  if (!local) return 'pull';
  if (stamp.at === 0) return 'pull';
  if (stamp.at > stamp.synced) return remoteAt > stamp.synced && remoteAt >= stamp.at ? 'pull' : 'push';
  return remoteAt > stamp.synced ? 'pull' : 'same';
}

async function customPart(client: Client, id: string, stamp: Stamp, remote: unknown, updated: unknown, active: () => boolean, conflict: () => void): Promise<Result> {
  if (remote !== null) mediaOf(remote);
  const raw = localStorage.getItem(userDataKey('profileCustom'));
  const mode = choose(raw !== null, remote !== null, stamp, timestamp(updated));
  if (mode === 'same') return 'same';
  const local = mode === 'push' ? JSON.parse(raw!) : null;
  const versions = mediaOf(mode === 'pull' ? remote : local);
  const bucket = client.storage.from('profile-media');
  if (mode === 'pull') {
    for (const key of mediaKeys) {
      const version = versions[key];
      if (!version || await getMedia(key, version)) continue;
      const { data } = bucket.getPublicUrl(`${id}/${key}-${version}`);
      const response = await fetch(data.publicUrl);
      if (!response.ok) throw new Error('Media download failed');
      const blob = await response.blob();
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type)) throw new Error('Invalid cloud media');
      if (!await commitPulledMedia(key, blob, version, active)) {
        if (!active()) return 'skipped';
        throw new Error('Media storage failed');
      }
    }
    if (!active() || !stable(id, 'custom', stamp.at)) return 'skipped';
    writePulled([['profileCustom', remote as Record<string, unknown>]]);
    finish(id, 'custom', stamp.at, timestamp(updated), active, true);
    return 'pulled';
  }
  const existing = await names(bucket, id);
  const current = new Set<string>();
  for (const key of mediaKeys) {
    const path = versions[key] ? `${key}-${versions[key]}` : '';
    if (!path) continue;
    current.add(path);
    if (existing.some((item) => item.name === path)) continue;
    const blob = await getMedia(key, versions[key]);
    if (!blob) throw new Error('Local media missing');
    if (!active()) return 'skipped';
    const { error } = await bucket.upload(`${id}/${path}`, blob, { contentType: blob.type, upsert: true });
    if (error) throw error;
  }
  if (!active() || !stable(id, 'custom', stamp.at)) return 'skipped';
  const query = client.from('profiles').update({ custom: local, custom_updated_at: new Date(stamp.at).toISOString() }).eq('id', id);
  const { data, error } = await (updated === null ? query.is('custom_updated_at', null) : query.eq('custom_updated_at', updated as string)).select('custom_updated_at');
  if (!active()) return 'skipped';
  if (error) throw error;
  if (!data?.length) { conflict(); return 'skipped'; }
  // Перед удалением перечитываем профиль: другое устройство могло уже сослаться на старую картинку
  const fresh = await client.from('profiles').select('custom').eq('id', id).maybeSingle();
  if (!active()) return 'skipped';
  if (fresh.error) throw fresh.error;
  try { for (const [key, version] of Object.entries(mediaOf(fresh.data?.custom))) current.add(`${key}-${version}`); } catch {}
  const stale = existing.filter((item) => !current.has(item.name) && timestamp(item.created_at) > 0 && timestamp(item.created_at) < Date.now() - 600_000).map((item) => `${id}/${item.name}`);
  for (let offset = 0; offset < stale.length; offset += 100) {
    if (!active()) return 'skipped';
    const { error } = await bucket.remove(stale.slice(offset, offset + 100));
    if (error) throw error;
  }
  finish(id, 'custom', stamp.at, timestamp(data[0].custom_updated_at), active);
  return 'pushed';
}
async function dataPart(client: Client, id: string, stamp: Stamp, row: unknown, active: () => boolean, conflict: () => void): Promise<Result> {
  const cloud = cloudData(row);
  const mode = choose(hasStoredUserData('data'), cloud !== null, stamp, record(row) ? timestamp(row.updated_at) : 0);
  if (mode === 'same') return 'same';
  if (mode === 'pull') {
    if (!active() || !stable(id, 'data', stamp.at)) return 'skipped';
    // Все ключи пишутся вместе: при ошибке (например, нет места) возвращаем прежние значения, чтобы не осталось смеси
    const writes: UserDataWrite[] = [
      ...langs.map((lang): UserDataWrite => ['favorites', cloud!.favorites[lang], lang]),
      ['roster', cloud!.roster], ['profileUid', cloud!.settings.uid],
    ];
    writePulled(writes);
    if (!active()) return 'skipped';
    finish(id, 'data', stamp.at, record(row) ? timestamp(row.updated_at) : 0, active, true);
    return 'pulled';
  }
  const local = localData();
  if (!active() || !stable(id, 'data', stamp.at)) return 'skipped';
  const { data, error } = record(row)
    ? await (row.updated_at === null
      ? client.from('user_data').update(local).eq('user_id', id).is('updated_at', null)
      : client.from('user_data').update(local).eq('user_id', id).eq('updated_at', row.updated_at as string)).select('updated_at')
    : await client.from('user_data').insert({ user_id: id, ...local }).select('updated_at');
  if (!active()) return 'skipped';
  if (error?.code === '23505') { conflict(); return 'skipped'; }
  if (error) throw error;
  if (!data?.length) { conflict(); return 'skipped'; }
  finish(id, 'data', stamp.at, timestamp(data[0].updated_at), active);
  return 'pushed';
}

let generation = 0;
let retries = 0;
let retryTimer: number | undefined;
async function run(): Promise<SyncResult> {
  const result = blank();
  const turn = generation;
  if (!hasSession()) return result;
  try {
    const { getSupabase } = await import('./auth');
    const client = getSupabase();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const id = data.session?.user.id;
    const active = () => generation === turn && hasSession();
    if (!id || !active()) return result;
    const [profile, userData] = await Promise.all([
      client.from('profiles').select('custom,custom_updated_at').eq('id', id).maybeSingle(),
      client.from('user_data').select('favorites,roster,settings,updated_at').eq('user_id', id).maybeSingle(),
    ]);
    if (!active()) return result;
    if (profile.error || userData.error || !profile.data) throw profile.error || userData.error || new Error('Profile missing');
    const state = readMarker(id);
    if (!active()) return result;
    saveMarker(state);
    let failed = false;
    let conflict = false;
    try { result.custom = await customPart(client, id, state.custom, profile.data.custom, profile.data.custom_updated_at, active, () => { conflict = true; }); }
    catch { if (!active()) return result; failed = true; }
    if (!active()) return result;
    try { result.data = await dataPart(client, id, state.data, userData.data, active, () => { conflict = true; }); }
    catch { if (!active()) return result; failed = true; }
    if (!active()) return result;
    if (conflict && retries < 3) {
      retries++;
      clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => { retryTimer = undefined; void syncNow(); }, 2000);
    } else if (!conflict) retries = 0;
    if (!active()) return result;
    if (result.custom === 'pulled' || result.data === 'pulled') document.dispatchEvent(new CustomEvent('gf:profile-synced', { detail: result }));
    if (!active()) return result;
    document.dispatchEvent(new Event(failed ? 'gf:profile-sync-error' : 'gf:profile-sync-ok'));
    return result;
  } catch {
    if (generation === turn && hasSession()) document.dispatchEvent(new Event('gf:profile-sync-error'));
    return result;
  }
}

let tail = Promise.resolve(blank());
export function syncNow(): Promise<SyncResult> {
  cancelScheduledSync();
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  retryTimer = undefined;
  const next = tail.then(run, run);
  tail = next;
  return next;
}
onSessionChange(() => {
  generation++;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  retries = 0;
  if (hasSession()) void syncNow();
});

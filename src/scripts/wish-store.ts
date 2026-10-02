import { hasSession } from './user-data/session';

export type Wish = { id: string; uid: string; gacha_type: string; time: string; name: string; item_type: string; rank_type: string; item_id?: string };
export type WishStore = {
  mode: 'local' | 'cloud';
  offline?: boolean;
  uids(): string[];
  list(uid: string): Wish[];
  merge(uid: string, incoming: Wish[]): Promise<number>;
  wipe(uid: string): Promise<void>;
};

const RANK_TYPES = new Set(['3', '4', '5']);
const GACHA_TYPES = new Set(['100', '200', '301', '302', '400', '500']);
const uidOk = (uid: string) => /^([0-9]{9,10}|manual)$/.test(uid);
const cmpId = (a: Wish, b: Wish) => (a.id.length - b.id.length) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function validWish(value: unknown, uid: string): Wish | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const w = value as Record<string, unknown>;
  if (!RANK_TYPES.has(w.rank_type as string) || !GACHA_TYPES.has(w.gacha_type as string)) return null;
  const id = String(w.id ?? ''), time = String(w.time ?? ''), name = String(w.name ?? '');
  const item_type = String(w.item_type ?? ''), item_id = w.item_id == null ? undefined : String(w.item_id);
  if (!id || id.length > 32 || time.length > 32 || name.length > 100 || item_type.length > 32 || (item_id && item_id.length > 32)) return null;
  return { id, uid, gacha_type: w.gacha_type as string, time, name, item_type, rank_type: w.rank_type as string, item_id };
}

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

function localUids() {
  const saved = read<unknown>('gf:wish-uids', []);
  const uids = Array.isArray(saved) ? saved.filter((uid): uid is string => typeof uid === 'string') : [];
  try { for (const key of Object.keys(localStorage)) if (key.startsWith('gf:wishes:')) uids.push(key.slice('gf:wishes:'.length)); } catch {}
  return [...new Set(uids.filter(uidOk))];
}

function localList(uid: string) {
  const saved = read<unknown>(`gf:wishes:${uid}`, []);
  return Array.isArray(saved) ? saved.map((wish) => validWish(wish, uid)).filter((wish): wish is Wish => !!wish).sort(cmpId) : [];
}

function memory() {
  const lists = new Map<string, Wish[]>();
  return {
    lists,
    uids: () => [...lists.keys()],
    list: (uid: string) => lists.get(uid) ?? [],
    add(uid: string, incoming: Wish[]) {
      const map = new Map((lists.get(uid) ?? []).map((wish) => [wish.id, wish]));
      let added = 0;
      for (const value of incoming) {
        const wish = validWish(value, uid);
        if (wish && !map.has(wish.id)) { map.set(wish.id, wish); added++; }
      }
      if (map.size) lists.set(uid, [...map.values()].sort(cmpId));
      return added;
    },
  };
}

function localStore(offline = false): WishStore {
  const state = memory();
  for (const uid of localUids()) state.add(uid, localList(uid));
  // Другая вкладка могла изменить историю: перед записью перечитываем актуальную версию
  const sync = (uid: string) => {
    state.lists.delete(uid);
    state.add(uid, localList(uid));
  };
  return {
    mode: 'local', offline,
    uids: state.uids,
    list: state.list,
    async merge(uid, incoming) {
      if (!uidOk(uid)) throw new Error('Неверный UID.');
      sync(uid);
      const known = new Set(state.list(uid).map((wish) => wish.id));
      const fresh = [...new Map<string, Wish>(incoming.map((wish) => validWish(wish, uid))
        .filter((wish): wish is Wish => !!wish && !known.has(wish.id)).map((wish) => [wish.id, wish] as const)).values()];
      if (!fresh.length) return 0;
      const next = [...state.list(uid), ...fresh].sort(cmpId);
      // Записи, не прошедшие проверку (например, оставшиеся после переноса в аккаунт), не выбрасываем
      const raw = read<unknown>(`gf:wishes:${uid}`, []);
      const rejected = Array.isArray(raw) ? raw.filter((value) => !validWish(value, uid)) : [];
      localStorage.setItem(`gf:wishes:${uid}`, JSON.stringify([...next, ...rejected]));
      localStorage.setItem('gf:wish-uids', JSON.stringify([...new Set([...localUids(), uid])]));
      return state.add(uid, fresh);
    },
    async wipe(uid) {
      sync(uid);
      localStorage.removeItem(`gf:wishes:${uid}`);
      state.lists.delete(uid);
      localStorage.setItem('gf:wish-uids', JSON.stringify(localUids().filter((saved) => saved !== uid)));
    },
  };
}

export async function openWishStore(signal?: AbortSignal): Promise<WishStore> {
  if (!hasSession()) return localStore();

  try {
    const { getSupabase } = await import('./auth');
    const supabase = getSupabase();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) return localStore();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const state = memory();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('wishes')
        .select('game_uid,id,gacha_type,time,name,item_type,rank_type,item_id')
        .eq('user_id', user.id).order('game_uid').order('id').range(offset, offset + 999);
      if (error || !data) throw new Error(error?.message || 'Не удалось загрузить историю аккаунта.');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = new Map<string, Wish[]>();
      for (const row of data) {
        if (typeof row.game_uid !== 'string' || !uidOk(row.game_uid)) continue;
        const list = page.get(row.game_uid) ?? [];
        list.push(row);
        page.set(row.game_uid, list);
      }
      for (const [uid, list] of page) state.add(uid, list);
      if (data.length < 1000) break;
    }

    const aborted = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
    // Вошли или вышли в другой вкладке — в чужой аккаунт не пишем
    const ensureSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error || data.session?.user.id !== user.id) throw new Error('Сессия изменилась. Обновите страницу.');
    };
    const columns = 'game_uid,id,gacha_type,time,name,item_type,rank_type,item_id';

    const cloud: WishStore = {
      mode: 'cloud',
      uids: state.uids,
      list: state.list,
      async merge(uid, incoming) {
        if (!uidOk(uid)) throw new Error('Неверный UID.');
        // Отправляем все входящие записи, даже известные этой вкладке: их могли удалить из аккаунта в другой вкладке
        const fresh = [...new Map<string, Wish>(incoming.map((wish) => validWish(wish, uid))
          .filter((wish): wish is Wish => !!wish).map((wish) => [wish.id, wish] as const)).values()];
        let added = 0;
        for (let offset = 0; offset < fresh.length; offset += 500) {
          aborted();
          const batch = fresh.slice(offset, offset + 500);
          const rows = batch.map(({ uid: game_uid, ...wish }) => ({ ...wish, user_id: user.id, game_uid }));
          await ensureSession();
          aborted();
          const { data, error } = await supabase.from('wishes')
            .upsert(rows, { onConflict: 'user_id,game_uid,id', ignoreDuplicates: true }).select(columns);
          if (error || !data) throw new Error(error?.message || 'Не удалось сохранить историю аккаунта.');
          aborted();
          // В память — то, что реально лежит в базе: вставленные строки и уже существовавшие дубликаты
          state.add(uid, data);
          const inserted = new Set(data.map((row) => row.id));
          const missing = batch.map((wish) => wish.id).filter((id) => !inserted.has(id));
          if (missing.length) {
            const { data: existing, error: lookupError } = await supabase.from('wishes').select(columns)
              .eq('user_id', user.id).eq('game_uid', uid).in('id', missing);
            if (lookupError || !existing) throw new Error(lookupError?.message || 'Не удалось загрузить историю аккаунта.');
            if (existing.length < missing.length) throw new Error('Не удалось подтвердить сохранение истории в аккаунте.');
            aborted();
            state.add(uid, existing);
          }
          added += data.length;
        }
        return added;
      },
      async wipe(uid) {
        await ensureSession();
        aborted();
        const { error } = await supabase.from('wishes').delete().eq('user_id', user.id).eq('game_uid', uid);
        if (error) throw new Error(error.message);
        aborted();
        state.lists.delete(uid);
      },
    };

    // Перенос истории из браузера: удаляем только то, что точно попало в аккаунт.
    // Записи, не прошедшие проверку, остаются в браузере; если другая вкладка дописала историю во время переноса — переносим и её.
    const cleared = new Set<string>();
    for (const uid of localUids()) {
      const key = `gf:wishes:${uid}`;
      for (let attempt = 0; attempt <= 3; attempt++) {
        aborted();
        const raw = localStorage.getItem(key);
        if (raw === null) { cleared.add(uid); break; }
        let saved: unknown;
        try { saved = JSON.parse(raw); } catch { break; }
        if (!Array.isArray(saved)) break;
        const valid: Wish[] = [], rejected: unknown[] = [];
        for (const value of saved) {
          const wish = validWish(value, uid);
          if (wish) valid.push(wish); else rejected.push(value);
        }
        await cloud.merge(uid, valid);
        aborted();
        if (localStorage.getItem(key) !== raw) continue;
        if (rejected.length) localStorage.setItem(key, JSON.stringify(rejected));
        else { localStorage.removeItem(key); cleared.add(uid); }
        break;
      }
    }
    if (cleared.size) {
      const saved = read<unknown>('gf:wish-uids', []);
      const remaining = Array.isArray(saved) ? saved.filter((uid) => typeof uid !== 'string' || !cleared.has(uid)) : [];
      if (remaining.length) localStorage.setItem('gf:wish-uids', JSON.stringify(remaining));
      else localStorage.removeItem('gf:wish-uids');
    }
    return cloud;
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return localStore(true);
  }
}

import { currentUser, getSupabase } from '../auth';

const KEY = 'gf:map.collected';

function readLocal(): Set<number> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(stored)) return new Set(stored.filter((id): id is number =>
      typeof id === 'number' && Number.isSafeInteger(id) && id > 0).slice(0, 20000));
  } catch {}
  return new Set();
}
function addLocal(id: number) {
  const ids = readLocal();
  ids.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...ids])); } catch {}
}
function removeLocal(ids: number[]) {
  if (!ids.length) return;
  const local = readLocal();
  for (const id of ids) local.delete(id);
  try {
    if (local.size) localStorage.setItem(KEY, JSON.stringify([...local]));
    else localStorage.removeItem(KEY);
  } catch {}
}

export function createCollectedStore(validIds: number[]) {
  const valid = new Set(validIds);
  const listeners = new Set<() => void>();
  const pending = new Set<number>();
  let ids = readLocal();
  let owner: string | null = null;
  let cloud = false;
  let activeUser: string | null | undefined;
  let version = 1;
  let disposed = false;
  let loading: Promise<void> = Promise.resolve();
  const changed = () => { if (!disposed) for (const listener of listeners) listener(); };

  const load = async (userId: string | null, turn: number) => {
    if (!userId) return;
    const remote = new Set<number>();
    try {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await getSupabase().from('map_collected')
          .select('marker_id').eq('user_id', userId).order('marker_id').range(offset, offset + 999);
        if (error) throw error;
        for (const row of data ?? []) if (Number.isSafeInteger(row.marker_id) && row.marker_id > 0) remote.add(row.marker_id);
        if (!data || data.length < 1000) break;
      }
      if (disposed || turn !== version) return;
      owner = userId;
      cloud = true;
      ids = remote;
      changed();
      const local = readLocal();
      if (local.size) {
        const transfer = [...local].filter(id => valid.has(id));
        const obsolete = [...local].filter(id => !valid.has(id));
        if (obsolete.length) removeLocal(obsolete);
        for (let offset = 0; offset < transfer.length; offset += 500) {
          const batch = transfer.slice(offset, offset + 500);
          const { error } = await getSupabase().from('map_collected')
            .upsert(batch.map(marker_id => ({ user_id: userId, marker_id })),
              { onConflict: 'user_id,marker_id', ignoreDuplicates: true });
          if (error) throw error;
          if (disposed || turn !== version) return;
          for (const id of batch) {
            ids.add(id);
          }
          removeLocal(batch);
          changed();
        }
      }
    } catch (error) {
      console.warn('Map collected marks could not be loaded', error);
      if (disposed || turn !== version) return;
      if (!cloud) {
        ids = readLocal();
        changed();
      }
    }
  };
  const startLoad = (userId: string | null, initial = false) => {
    if (activeUser === userId || disposed) return;
    activeUser = userId;
    const turn = initial ? version : ++version;
    owner = null;
    cloud = false;
    ids = readLocal();
    if (!initial) pending.clear();
    changed();
    loading = new Promise<void>(resolve => {
      setTimeout(() => { void load(userId, turn).then(resolve); }, 0);
    });
  };
  const onStorage = (event: StorageEvent) => {
    // key === null — localStorage.clear() в другой вкладке
    if (event.storageArea !== localStorage || (event.key !== KEY && event.key !== null) || disposed || cloud) return;
    ids = readLocal();
    changed();
  };
  window.addEventListener('storage', onStorage);
  const { data: { subscription } } = getSupabase().auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    startLoad(session?.user?.id ?? null);
  });
  const ready: Promise<void> = currentUser().then((user) => {
    if (activeUser === undefined) startLoad(user?.id ?? null, true);
    return loading;
  }).catch((error) => {
    console.warn('Map account could not be loaded', error);
    if (activeUser === undefined) startLoad(null, true);
  });

  return {
    has: (id: number) => ids.has(id),
    size: () => ids.size,
    isPending: (id: number) => pending.has(id),
    ready,
    onChange(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); },
    async toggle(id: number): Promise<boolean> {
      const turn = version;
      if (disposed || !valid.has(id) || pending.has(id)) return ids.has(id);
      pending.add(id);
      changed();
      try {
        await ready;
        if (disposed || turn !== version) return ids.has(id);
        await loading;
        if (disposed || turn !== version) return ids.has(id);
        const userId = cloud ? owner : null;
        const next = !ids.has(id);
        if (next) ids.add(id);
        else ids.delete(id);
        changed();
        if (!userId) {
          if (next) addLocal(id);
          else removeLocal([id]);
          return next;
        }
        try {
          const query = getSupabase().from('map_collected');
          const { error } = next
            ? await query.insert({ user_id: userId, marker_id: id })
            : await query.delete().eq('user_id', userId).eq('marker_id', id);
          if (error) throw error;
          if (!disposed && turn === version) removeLocal([id]);
        } catch (error) {
          console.warn('Map collected mark could not be saved', error);
          if (!disposed && turn === version) {
            if (next) ids.delete(id);
            else ids.add(id);
            changed();
          }
        }
        return ids.has(id);
      } finally {
        if (turn === version) {
          pending.delete(id);
          changed();
        }
      }
    },
    dispose() {
      disposed = true;
      version++;
      subscription.unsubscribe();
      window.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
}
export type CollectedStore = ReturnType<typeof createCollectedStore>;

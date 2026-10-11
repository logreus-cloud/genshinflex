import type { Wish, WishStore } from './wish-store';

type ImportCode = 'bad-link' | 'expired' | 'empty' | 'server' | 'api';

export class WishImportError extends Error {
  constructor(public code: ImportCode, message: string) {
    super(message);
    this.name = 'WishImportError';
  }
}

type Options = {
  signal: AbortSignal;
  onProgress?: (type: string, page: number) => void;
  onSaving?: (saving: boolean) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal.addEventListener('abort', done, { once: true });
  if (signal.aborted) done();
});

const aborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};

export async function importFromLink(raw: string, store: WishStore, opts: Options): Promise<{ uid: string; added: number }> {
  let params: URLSearchParams;
  try { params = new URL(raw.trim()).searchParams; }
  catch { throw new WishImportError('bad-link', 'Это не похоже на ссылку. Скопируйте её скриптом ещё раз.'); }
  if (!params.get('authkey')) throw new WishImportError('bad-link', 'В ссылке нет authkey. Откройте историю молитв в игре и запустите скрипт снова.');

  const sleep = (ms: number) => (opts.sleep ?? pause)(ms, opts.signal);
  let total = 0;
  let foundUid = '';
  for (const type of ['301', '302', '200', '500', '100']) {
    aborted(opts.signal);
    let endId = '0';
    const known = new Set(foundUid ? store.list(foundUid).map((wish) => wish.id) : []);
    const got: Wish[] = [];
    for (let page = 1; ; page++) {
      opts.onProgress?.(type, page);
      const q = new URLSearchParams({
        authkey: params.get('authkey')!, authkey_ver: params.get('authkey_ver') ?? '1',
        sign_type: params.get('sign_type') ?? '2', lang: 'ru', gacha_type: type,
        page: String(page), end_id: endId, game_biz: params.get('game_biz') ?? 'hk4e_global',
        region: params.get('region') ?? '',
      });
      let res: Response;
      try { res = await fetch(`/api/gacha?${q}`, { signal: opts.signal }); }
      catch (error) {
        aborted(opts.signal);
        throw new WishImportError('server', 'Сервер не ответил. Попробуйте ещё раз через минуту.');
      }
      const body = await res.json().catch(() => null);
      aborted(opts.signal);
      if (!body) throw new WishImportError('server', 'Сервер не ответил. Попробуйте ещё раз через минуту.');
      if (body.retcode === -110) { await sleep(1500); aborted(opts.signal); page--; continue; }
      if (body.retcode === -101) throw new WishImportError('expired', 'Ссылка устарела (живёт сутки). Откройте историю в игре и получите новую.');
      if (body.retcode !== 0) throw new WishImportError('api', body.error ?? body.message ?? 'Не удалось загрузить историю.');
      const list: Wish[] = body.data?.list ?? [];
      if (!list.length) break;
      if (!foundUid) {
        foundUid = list[0].uid;
        for (const wish of store.list(foundUid)) known.add(wish.id);
      }
      const fresh = list.filter((wish) => !known.has(wish.id));
      got.push(...fresh);
      if (fresh.length < list.length) break; // дошли до уже сохранённых
      endId = list.at(-1)!.id;
      await sleep(350);
      aborted(opts.signal);
    }
    if (foundUid && got.length) {
      opts.onSaving?.(true);
      const added = await store.merge(foundUid, got);
      aborted(opts.signal);
      total += added;
      opts.onSaving?.(false);
    }
  }
  if (!foundUid) throw new WishImportError('empty', 'История пуста: на этом аккаунте ещё не было молитв за последние 6 месяцев.');
  return { uid: foundUid, added: total };
}

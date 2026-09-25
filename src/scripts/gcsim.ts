export type SimResult = { dps: number; iterations: number; duration: number; chars: { name: string; dps: number }[] };

type Reply = { id: number; result?: unknown; error?: string };
type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void };
type Client = {
  worker: Worker; pending: Map<number, Pending>;
  call: <T>(action: string, data?: Record<string, unknown>, transfer?: Transferable[]) => Promise<T>;
};
let clients: Client[] = [];
let ready: Promise<Client[]> | null = null;
let size = 0;
let nextId = 0;
let queue: Promise<unknown> = Promise.resolve();

const defaultWorkers = () => Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
const abortError = () => new DOMException('Симуляция отменена', 'AbortError');

function makeClient(): Client {
  const worker = new Worker(new URL('./gcsim-worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  };
  worker.onerror = (event) => {
    if (clients.some((client) => client.worker === worker)) dispose(new Error(event.message || 'Ошибка Web Worker gcsim'));
  };
  return {
    worker, pending,
    call<T>(action: string, data = {}, transfer = []) {
      return new Promise<T>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        try { worker.postMessage({ id, action, ...data }, transfer); }
        catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
  };
}

function dispose(reason = new Error('Движок gcsim остановлен'), reset = true) {
  for (const client of clients) {
    for (const request of client.pending.values()) request.reject(reason);
    client.pending.clear();
    client.worker.terminate();
  }
  clients = [];
  if (reset) ready = null;
  if (reset) size = 0;
}

function pool(count: number): Promise<Client[]> {
  if (ready && size === count) return ready;
  const previous = ready;
  ready = (async () => {
    if (previous) await previous.catch(() => {});
    dispose(undefined, false);
    try {
      clients = Array.from({ length: count }, makeClient);
      await Promise.all(clients.map((client) => client.call('load')));
      return clients;
    } catch (error) {
      dispose();
      throw error;
    }
  })();
  size = count;
  return ready;
}

function exclusive<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const result = new Promise<T>((resolve, reject) => {
    let started = false, settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (started) dispose(abortError());
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const work = queue.then(async () => {
      if (settled) {
        signal?.removeEventListener('abort', onAbort);
        return;
      }
      started = true;
      try {
        const value = await task();
        if (!settled) {
          settled = true;
          resolve(value);
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    });
    queue = work.then(() => {}, () => {});
  });
  return result;
}

export function warmUp(): void {
  void exclusive(() => pool(clients.length || defaultWorkers())).catch(() => {});
}

export function validateSim(config: string): Promise<string | null> {
  return exclusive(async () => {
    const [first] = await pool(defaultWorkers());
    return first.call<string | null>('validate', { config });
  });
}

export function runSim(
  config: string,
  opts: { iterations: number; workers?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
): Promise<SimResult> {
  return exclusive(async () => {
    const total = Math.trunc(opts.iterations);
    if (!Number.isFinite(total) || total < 1) throw new Error('Число итераций должно быть положительным');
    if (opts.signal?.aborted) throw abortError();
    const count = Math.min(total, Math.max(1, Math.trunc(opts.workers ?? defaultWorkers())));
    const group = await pool(count);
    if (opts.signal?.aborted) throw abortError();
    let done = 0, lastProgress = 0;
    try {
      const checkAbort = () => { if (opts.signal?.aborted) throw abortError(); };
      const [first] = group;
      const meta = await first.call<{ character_details?: { name: string }[] }>('aggregator', { config });
      await Promise.all(group.map((client) => client.call('worker', { config })));
      checkAbort();
      const shares = group.map((_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));
      await Promise.all(group.map(async (client, i) => {
        let remaining = shares[i];
        while (remaining > 0) {
          checkAbort();
          const amount = Math.min(4, remaining);
          const bytes = await client.call<Uint8Array[]>('simulate', { count: amount });
          checkAbort();
          await first.call('aggregate', { bytes }, bytes.map((value) => value.buffer));
          remaining -= amount;
          done += amount;
          const now = performance.now();
          if (now - lastProgress >= 100 || done === total) {
            lastProgress = now;
            opts.onProgress?.(done, total);
          }
        }
      }));
      checkAbort();
      const output = await first.call<{
        stats: { dps: { mean: number }; character_dps: { mean: number }[]; duration: { mean: number }; iterations: number };
      }>('flush');
      return {
        dps: output.stats.dps.mean, iterations: output.stats.iterations, duration: output.stats.duration.mean,
        chars: (meta.character_details ?? []).map((character, i) => ({
          name: character.name, dps: output.stats.character_dps?.[i]?.mean ?? 0,
        })),
      };
    } catch (error) {
      if (opts.signal?.aborted) throw abortError();
      dispose();
      throw error;
    }
  }, opts.signal);
}

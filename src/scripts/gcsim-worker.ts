type GoRuntime = { importObject: WebAssembly.Imports; run: (instance: WebAssembly.Instance) => Promise<void> };
type Api = typeof globalThis & {
  Go: new () => GoRuntime;
  validateConfig: (config: string) => string;
  initializeWorker: (config: string) => null | string;
  initializeAggregator: (config: string) => string;
  simulate: () => Uint8Array | string;
  aggregate: (bytes: Uint8Array) => null | string;
  flush: () => string;
};
type Request = { id: number; action: string; config?: string; count?: number; bytes?: Uint8Array[] };
const api = globalThis as Api;
let loading: Promise<void> | null = null;

function check<T>(value: T): T {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.error) throw new Error(String(parsed.error));
    } catch (error) {
      if (error instanceof SyntaxError) return value;
      throw error;
    }
  }
  return value;
}

function load() {
  loading ??= (async () => {
    await import(/* @vite-ignore */ '/gcsim/wasm_exec.js');
    const response = await fetch('/gcsim/gcsim.wasm.gz');
    if (!response.ok) throw new Error(`Не удалось загрузить gcsim.wasm: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const gzip = new Uint8Array(bytes, 0, 2);
    const raw = gzip[0] === 0x1f && gzip[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      : bytes;
    const go = new api.Go();
    const { instance } = await WebAssembly.instantiate(raw, go.importObject);
    void go.run(instance);
  })();
  return loading;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, action, config, count, bytes } = event.data;
  try {
    await load();
    let result: unknown = null;
    let transfer: Transferable[] = [];
    if (action === 'load') result = null;
    else if (action === 'validate') {
      const value = api.validateConfig(config ?? '');
      try { result = JSON.parse(value).error ?? null; }
      catch { result = 'Некорректный ответ gcsim при проверке конфига'; }
    } else if (action === 'worker') check(api.initializeWorker(config ?? ''));
    else if (action === 'aggregator') result = JSON.parse(check(api.initializeAggregator(config ?? '')));
    else if (action === 'simulate') {
      const batch: Uint8Array[] = [];
      for (let i = 0; i < (count ?? 0); i++) {
        const value = check(api.simulate());
        if (!(value instanceof Uint8Array)) throw new Error('gcsim не вернул результат симуляции');
        batch.push(value);
        // Между пачками воркер принимает отмену и данные других воркеров.
        if (i % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      result = batch;
      transfer = batch.map((value) => value.buffer);
    } else if (action === 'aggregate') {
      for (const value of bytes ?? []) check(api.aggregate(value));
    } else if (action === 'flush') result = JSON.parse(check(api.flush()));
    else throw new Error(`Неизвестное действие: ${action}`);
    self.postMessage({ id, result }, { transfer });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};

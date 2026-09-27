export function onPage(init: (signal: AbortSignal) => void): void {
  let current: AbortController | undefined;
  document.addEventListener('astro:page-load', () => {
    current?.abort();
    current = new AbortController();
    try { init(current.signal); } catch (error) { console.error(error); }
  });
  document.addEventListener('astro:before-swap', () => {
    current?.abort();
    current = undefined;
  });
}

export function cleanup(signal: AbortSignal, fn: () => void): void {
  if (signal.aborted) fn();
  else signal.addEventListener('abort', fn, { once: true });
}

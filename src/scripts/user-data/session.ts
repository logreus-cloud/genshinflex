export const SESSION_KEY = 'gf:auth';

export function hasSession(): boolean {
  try { return localStorage.getItem(SESSION_KEY) !== null; } catch { return false; }
}

export function onSessionChange(listener: () => void, { signal }: { signal?: AbortSignal } = {}) {
  document.addEventListener(SESSION_KEY, listener, { signal });
  window.addEventListener('storage', (event) => {
    try {
      if (event.storageArea === localStorage && (event.key === SESSION_KEY || event.key === null)) listener();
    } catch {}
  }, { signal });
}

export function notifySessionChanged() {
  document.dispatchEvent(new Event(SESSION_KEY));
}

import { BASE, t } from './search';
import { hasSession, onSessionChange } from './user-data/session';

const validNick = /^[A-Za-z0-9_-]{3,24}$/;

export function initPublicSettings(signal: AbortSignal) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const field = $('public-field');
  const input = $<HTMLInputElement>('public-nick');
  const save = $<HTMLButtonElement>('public-nick-save');
  const visible = $<HTMLInputElement>('public-visible');
  const status = $('public-nick-status');
  const link = $<HTMLAnchorElement>('public-link');
  const copy = $<HTMLButtonElement>('public-copy');
  const note = $('public-hidden-note');
  const hint = t('3–24 символа: латиница, цифры, _ и -');
  let userId = '', nickname = '', isPublic = false;
  let loadRequest = 0, copyRequest = 0;
  let copyTimer: number | undefined;

  const setStatus = (message: string, bad = false) => { status.textContent = message; status.classList.toggle('bad', bad); };
  const render = () => {
    link.href = `${BASE}/u/${encodeURIComponent(nickname)}/`;
    link.hidden = copy.hidden = false;
    note.hidden = isPublic;
  };
  const reset = () => {
    userId = nickname = ''; isPublic = false;
    field.hidden = link.hidden = copy.hidden = note.hidden = true;
    input.value = ''; input.disabled = save.disabled = visible.disabled = false;
    visible.checked = false;
    copy.textContent = t('Скопировать ссылку');
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    copyTimer = undefined; copyRequest++;
    setStatus(hint);
  };

  const load = async () => {
    const request = ++loadRequest;
    const current = () => !signal.aborted && request === loadRequest;
    reset();
    if (!hasSession()) return;
    try {
      const { getSupabase } = await import('./auth');
      if (!current()) return;
      const client = getSupabase();
      const { data: session, error: sessionError } = await client.auth.getSession();
      if (!current() || sessionError || !session.session?.user.id) return;
      const id = session.session.user.id;
      const { data, error } = await client.from('profiles').select('nickname,is_public').eq('id', id).maybeSingle();
      if (!current() || error || !data || typeof data.nickname !== 'string' || typeof data.is_public !== 'boolean') return;
      userId = id; nickname = data.nickname; isPublic = data.is_public;
      input.value = nickname; visible.checked = isPublic;
      field.hidden = false;
      render();
    } catch { /* Нет сессии или сети — настройки остаются скрыты */ }
  };

  save.addEventListener('click', async () => {
    const id = userId, request = loadRequest, next = input.value;
    const current = () => !signal.aborted && request === loadRequest && userId === id;
    if (!id || input.disabled || next === nickname) return;
    if (!validNick.test(next)) { setStatus(t('Недопустимый адрес'), true); return; }
    // Ник и видимость сохраняются по очереди: у них общий статус
    input.disabled = save.disabled = visible.disabled = true;
    setStatus('');
    try {
      const { getSupabase } = await import('./auth');
      if (!current()) return;
      const { data, error } = await getSupabase().from('profiles').update({ nickname: next }).eq('id', id).select('nickname');
      if (!current()) return;
      if (error) {
        setStatus(t(error.code === '23505' ? 'Этот адрес уже занят' : error.code === '23514' ? 'Недопустимый адрес' : 'Не удалось сохранить'), true);
        return;
      }
      if (!data?.[0]?.nickname) { setStatus(t('Не удалось сохранить'), true); return; }
      nickname = data[0].nickname;
      input.value = nickname;
      render();
      setStatus(t('Адрес сохранён'));
    } catch { if (current()) setStatus(t('Не удалось сохранить'), true); }
    finally { if (current()) input.disabled = save.disabled = visible.disabled = false; }
  }, { signal });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    save.click();
  }, { signal });

  visible.addEventListener('change', async () => {
    const id = userId, request = loadRequest, next = visible.checked;
    const current = () => !signal.aborted && request === loadRequest && userId === id;
    if (!id || input.disabled) { visible.checked = isPublic; return; }
    visible.disabled = input.disabled = save.disabled = true;
    setStatus(hint);
    try {
      const { getSupabase } = await import('./auth');
      if (!current()) return;
      const { data, error } = await getSupabase().from('profiles').update({ is_public: next }).eq('id', id).select('is_public');
      if (!current()) return;
      if (error || data?.[0]?.is_public !== next) throw new Error();
      isPublic = next;
      render();
    } catch {
      if (!current()) return;
      visible.checked = isPublic;
      setStatus(t('Не удалось сохранить'), true);
    } finally { if (current()) visible.disabled = input.disabled = save.disabled = false; }
  }, { signal });

  copy.addEventListener('click', async () => {
    const href = link.getAttribute('href');
    if (!userId || !href) return;
    const request = loadRequest, attempt = ++copyRequest;
    const current = () => !signal.aborted && request === loadRequest && attempt === copyRequest;
    try {
      await navigator.clipboard.writeText(location.origin + href);
      if (!current()) return;
      copy.textContent = t('Скопировано');
    } catch {
      if (!current()) return;
      copy.textContent = t('Не удалось скопировать');
    }
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => { if (current()) copy.textContent = t('Скопировать ссылку'); }, 2000);
  }, { signal });

  signal.addEventListener('abort', () => { if (copyTimer !== undefined) clearTimeout(copyTimer); }, { once: true });
  void load();
  onSessionChange(() => { void load(); }, { signal });
}

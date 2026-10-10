import { t } from '../search';
import { hasSession, onSessionChange } from '../user-data/session';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function initNotifySettings(signal: AbortSignal) {
  const field = document.getElementById('notify-field');
  const loginNote = document.getElementById('notify-login-note');
  const status = document.getElementById('notify-status');
  const telegram = document.getElementById('notify-telegram');
  const telegramToggle = document.getElementById('notify-telegram-toggle') as HTMLInputElement | null;
  const controls = field ? [...field.querySelectorAll<HTMLInputElement>('input[data-notify]')] : [];
  const keys = ['reply', 'mention', 'follow', 'friend_request', 'friend_accept'];
  if (!field || !loginNote || !status || !telegram || !telegramToggle || controls.length !== keys.length || keys.some((key) => !controls.some((control) => control.dataset.notify === key))) return;
  let userId = '';
  let notify: Record<string, unknown> = {};
  let loadRequest = 0;

  const setStatus = (message: string, bad = false) => { status.textContent = message; status.classList.toggle('bad', bad); };
  const render = () => {
    for (const control of controls) control.checked = notify[control.dataset.notify!] !== false;
  };
  const reset = () => {
    userId = '';
    notify = {};
    field.hidden = true;
    loginNote.hidden = false;
    telegram.hidden = true;
    telegramToggle.checked = false;
    telegramToggle.disabled = false;
    for (const control of controls) { control.checked = true; control.disabled = false; }
    setStatus('');
  };

  const load = async () => {
    const request = ++loadRequest;
    let id = '';
    const current = () => !signal.aborted && request === loadRequest && userId === id;
    reset();
    if (!hasSession()) return;
    try {
      const { getSupabase } = await import('../auth');
      if (!current()) return;
      const client = getSupabase();
      const { data: session, error: sessionError } = await client.auth.getSession();
      if (!current()) return;
      if (sessionError) throw new Error();
      if (!session.session?.user.id) return;
      id = session.session.user.id;
      userId = id;
      const { data, error } = await client.rpc('get_notify_settings');
      if (!current()) return;
      if (error || !isRecord(data)) throw new Error();
      notify = data;
      render();
      field.hidden = false;
      loginNote.hidden = true;
      try {
        const { data: telegramStatus, error: telegramError } = await client.rpc('notify_telegram_status');
        if (!current()) return;
        if (!telegramError && isRecord(telegramStatus) && telegramStatus.linked === true) {
          telegram.hidden = false;
          telegramToggle.checked = telegramStatus.enabled === true;
          notify = { ...notify, telegram: telegramStatus.enabled === true };
        }
      } catch {
        if (!current()) return;
      }
    } catch {
      if (!current()) return;
      field.hidden = false;
      loginNote.hidden = true;
      for (const control of controls) control.disabled = true;
      setStatus(t('Не удалось загрузить'), true);
    }
  };

  for (const control of controls) control.addEventListener('change', async () => {
    const key = control.dataset.notify!;
    const id = userId, request = loadRequest, next = control.checked;
    const current = () => !signal.aborted && request === loadRequest && userId === id;
    if (!id || control.disabled) { control.checked = notify[key] !== false; return; }
    control.disabled = true;
    setStatus('');
    try {
      const { getSupabase } = await import('../auth');
      if (!current()) return;
      const { data, error } = await getSupabase().rpc('set_notify_setting', { p_kind: key, p_value: next });
      if (!current()) return;
      if (error || !isRecord(data) || (data[key] !== false) !== next) throw new Error();
      notify = { ...notify, [key]: data[key] !== false };
      control.checked = notify[key] !== false;
    } catch {
      if (!current()) return;
      control.checked = notify[key] !== false;
      setStatus(t('Не удалось сохранить'), true);
    } finally {
      if (current()) control.disabled = false;
    }
  }, { signal });

  telegramToggle.addEventListener('change', async () => {
    const id = userId, request = loadRequest, next = telegramToggle.checked;
    const current = () => !signal.aborted && request === loadRequest && userId === id;
    if (!id || telegramToggle.disabled) { telegramToggle.checked = notify.telegram === true; return; }
    telegramToggle.disabled = true;
    setStatus('');
    try {
      const { getSupabase } = await import('../auth');
      if (!current()) return;
      const { data, error } = await getSupabase().rpc('set_notify_setting', { p_kind: 'telegram', p_value: next });
      if (!current()) return;
      if (error || !isRecord(data) || (data.telegram === true) !== next) throw new Error();
      notify = { ...notify, telegram: data.telegram === true };
      telegramToggle.checked = notify.telegram === true;
    } catch {
      if (!current()) return;
      telegramToggle.checked = notify.telegram === true;
      setStatus(t('Не удалось сохранить'), true);
    } finally {
      if (current()) telegramToggle.disabled = false;
    }
  }, { signal });

  void load();
  onSessionChange(() => { void load(); }, { signal });
}

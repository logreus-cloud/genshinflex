import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { pageLang } from '../../i18n/client';
import { renderAuthor } from '../forum/author';
import { BASE, t } from '../search';
import { hasSession, onSessionChange } from '../user-data/session';
import { dmConversation, dmDeleteMessage, dmMarkRead, dmMessages, dmReport, dmSend, messageError, type DmReportReason, type Message } from './api';

type Rendered = { body: HTMLElement; button?: HTMLButtonElement; report?: HTMLElement; deleted: boolean };

export async function initThread(root: HTMLElement, conversationId: number, signal: AbortSignal) {
  if (signal.aborted) return;
  const back = root.querySelector<HTMLAnchorElement>('[data-back]')!;
  const head = root.querySelector<HTMLElement>('[data-thread-head]')!;
  const status = root.querySelector<HTMLElement>('[data-thread-status]')!;
  const older = root.querySelector<HTMLButtonElement>('[data-older]')!;
  const list = root.querySelector<HTMLElement>('[data-thread-list]')!;
  const form = root.querySelector<HTMLFormElement>('[data-compose]')!;
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const composeStatus = root.querySelector<HTMLElement>('[data-compose-status]')!;
  const closed = root.querySelector<HTMLElement>('[data-closed]')!;
  let generation = 0;
  let owner: string | null = null;
  let client: SupabaseClient<any> | null = null;
  let channel: RealtimeChannel | null = null;
  let oldestId: number | null = null;
  let newestId = 0;
  let syncedId = 0;
  let hasMore = false;
  let busyOlder = false;
  let sending = false;
  let loaded = false;
  let composing = false;
  const shown = new Map<number, Rendered>();
  let activeReport: number | null = null;
  const confirmations = new Map<number, ReturnType<typeof setTimeout>>();
  const realtimeDeleted = new Set<number>();
  const current = (turn: number) => !signal.aborted && turn === generation;
  const syncOlder = () => { older.hidden = !hasMore; older.disabled = busyOlder || !hasMore; };
  const clearConfirmation = (id: number) => {
    const timer = confirmations.get(id);
    if (timer) clearTimeout(timer);
    confirmations.delete(id);
  };
  const clearSubscription = () => {
    const previous = channel;
    const supabase = client;
    channel = null;
    client = null;
    if (previous && supabase) void supabase.removeChannel(previous);
  };
  const reset = () => {
    generation++;
    clearSubscription();
    confirmations.forEach((timer) => clearTimeout(timer));
    confirmations.clear();
    shown.clear();
    activeReport = null;
    realtimeDeleted.clear();
    owner = null;
    oldestId = null;
    newestId = 0;
    syncedId = 0;
    hasMore = false;
    busyOlder = false;
    sending = false;
    loaded = false;
    head.replaceChildren();
    list.replaceChildren();
    status.textContent = '';
    composeStatus.textContent = '';
    textarea.disabled = false;
    submit.disabled = false;
    form.hidden = true;
    closed.hidden = true;
    syncOlder();
    return generation;
  };
  const applyMessageState = (id: number, deleted: boolean) => {
    const rendered = shown.get(id);
    if (!rendered || (!deleted && !realtimeDeleted.has(id)) || rendered.deleted) return;
    rendered.deleted = true;
    clearConfirmation(id);
    rendered.body.textContent = t('Сообщение удалено');
    rendered.body.classList.add('muted', 'deleted');
    if (activeReport === id) activeReport = null;
    rendered.report?.remove();
    rendered.report = undefined;
    rendered.button?.remove();
    rendered.button = undefined;
  };
  const addMessage = (message: Message, turn: number) => {
    const deleted = message.deleted || realtimeDeleted.has(message.id);
    if (shown.has(message.id)) {
      applyMessageState(message.id, deleted);
      return false;
    }
    const item = document.createElement('div');
    item.className = `dm-msg${message.sender_id === owner ? ' mine' : ''}`;
    item.dataset.messageId = String(message.id);
    const body = document.createElement('p');
    body.className = 'dm-body';
    body.textContent = deleted ? t('Сообщение удалено') : message.body ?? '';
    if (deleted) body.classList.add('muted', 'deleted');
    const time = document.createElement('time');
    time.className = 'small muted dm-time';
    time.dateTime = message.created_at;
    time.textContent = new Date(message.created_at).toLocaleString(pageLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    item.append(body, time);
    const rendered: Rendered = { body, deleted };
    if (message.sender_id === owner && !deleted) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'small muted dm-delete';
      button.textContent = t('Удалить');
      button.addEventListener('click', async () => {
        if (!current(turn) || !owner) return;
        if (!confirmations.has(message.id)) {
          button.textContent = t('Точно удалить?');
          const timer = setTimeout(() => {
            confirmations.delete(message.id);
            if (current(turn) && button.isConnected) button.textContent = t('Удалить');
          }, 3000);
          confirmations.set(message.id, timer);
          return;
        }
        clearConfirmation(message.id);
        button.disabled = true;
        try {
          const deleted = await dmDeleteMessage(message.id);
          if (!deleted) throw new Error('dm:not_found');
          if (current(turn)) applyMessageState(message.id, true);
        } catch (error) {
          if (current(turn)) {
            status.textContent = messageError(error);
            button.disabled = false;
            button.textContent = t('Удалить');
          }
        }
      }, { signal });
      rendered.button = button;
      item.append(button);
    } else if (!deleted) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'small muted dm-delete';
      button.textContent = t('Пожаловаться');
      button.addEventListener('click', () => {
        if (!current(turn) || rendered.deleted) return;
        if (activeReport !== null) {
          const previous = shown.get(activeReport);
          previous?.report?.remove();
          if (previous) previous.report = undefined;
        }
        activeReport = message.id;
        const box = document.createElement('div');
        box.className = 'dm-report';
        const reportForm = document.createElement('form');
        reportForm.className = 'dm-report-form';
        reportForm.style.display = 'flex';
        reportForm.style.flexWrap = 'wrap';
        reportForm.style.gap = '.35rem';
        const reason = document.createElement('select');
        reason.className = 'input';
        reason.setAttribute('aria-label', t('Причина жалобы'));
        for (const [value, label] of [['spam', t('Спам')], ['abuse', t('Оскорбления')], ['other', t('Другое')]]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          reason.append(option);
        }
        const comment = document.createElement('input');
        comment.className = 'input';
        comment.maxLength = 500;
        comment.placeholder = t('Комментарий (необязательно)');
        const send = document.createElement('button');
        send.type = 'submit';
        send.className = 'btn small';
        send.textContent = t('Отправить жалобу');
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn small';
        cancel.textContent = t('Отмена');
        const reportStatus = document.createElement('p');
        reportStatus.className = 'small muted';
        cancel.addEventListener('click', () => {
          box.remove();
          rendered.report = undefined;
          activeReport = null;
        }, { signal });
        reportForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!current(turn) || rendered.deleted || activeReport !== message.id || send.disabled) return;
          send.disabled = true;
          reportStatus.textContent = '';
          try {
            await dmReport(message.id, reason.value as DmReportReason, comment.value.trim() || null);
            if (!current(turn) || rendered.deleted || activeReport !== message.id || rendered.report !== box) return;
            const success = document.createElement('p');
            success.className = 'small muted';
            success.textContent = t('Жалоба отправлена модераторам');
            box.replaceChildren(success);
            button.remove();
            rendered.button = undefined;
            activeReport = null;
          } catch (error) {
            if (current(turn) && !rendered.deleted && activeReport === message.id && rendered.report === box) reportStatus.textContent = messageError(error);
          } finally {
            if (current(turn) && activeReport === message.id && rendered.report === box) send.disabled = false;
          }
        }, { signal });
        reportForm.append(reason, comment, send, cancel);
        box.append(reportForm, reportStatus);
        rendered.report = box;
        item.append(box);
      }, { signal });
      rendered.button = button;
      item.append(button);
    }
    shown.set(message.id, rendered);
    let previous = list.lastElementChild;
    while (previous && Number((previous as HTMLElement).dataset.messageId) > message.id) previous = previous.previousElementSibling;
    list.insertBefore(item, previous ? previous.nextSibling : list.firstChild);
    oldestId = oldestId === null ? message.id : Math.min(oldestId, message.id);
    newestId = Math.max(newestId, message.id);
    return true;
  };
  const readIfVisible = () => {
    if (owner && loaded && document.visibilityState === 'visible') void dmMarkRead(conversationId).then(() => {
      document.dispatchEvent(new Event('gf:dm-read'));
    }).catch(() => {});
  };
  const loadOlder = async (turn: number) => {
    if (!current(turn) || !hasMore || busyOlder || oldestId === null) return;
    busyOlder = true;
    syncOlder();
    try {
      const rows = await dmMessages(conversationId, oldestId, 30);
      if (!current(turn)) return;
      const height = list.scrollHeight;
      const top = list.scrollTop;
      rows.slice().reverse().forEach((message) => addMessage(message, turn));
      list.scrollTop = top + list.scrollHeight - height;
      hasMore = rows.length === 30;
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    } finally {
      if (current(turn)) { busyOlder = false; syncOlder(); }
    }
  };
  const refreshLatest = async (turn: number, source: RealtimeChannel) => {
    const last = syncedId;
    let before: number | null = null;
    let latest = syncedId;
    const missing: Message[] = [];
    try {
      while (true) {
        const rows = await dmMessages(conversationId, before, 50);
        if (!current(turn) || channel !== source) return;
        if (rows.length) latest = Math.max(latest, rows[0].id);
        rows.forEach((message) => applyMessageState(message.id, message.deleted));
        missing.push(...rows.filter((message) => message.id > last));
        if (rows.length < 50 || rows.some((message) => message.id <= last)) break;
        before = rows[rows.length - 1].id;
      }
      syncedId = Math.max(syncedId, latest);
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      let incoming = false;
      missing.reverse().forEach((message) => {
        if (addMessage(message, turn) && message.sender_id !== owner) incoming = true;
      });
      if (nearBottom) list.scrollTop = list.scrollHeight;
      if (incoming && current(turn) && channel === source) readIfVisible();
    } catch {
      if (current(turn) && channel === source) status.textContent = t('Не удалось загрузить');
    }
  };
  const initialize = async () => {
    const turn = reset();
    back.href = `${BASE}/messages/`;
    back.textContent = t('← Все сообщения');
    try {
      const stored = hasSession();
      const { authUrl, getSupabase } = await import('../auth');
      if (!current(turn)) return;
      const supabase = getSupabase();
      const { data, error } = stored ? await supabase.auth.getSession() : { data: { session: null }, error: null };
      if (!current(turn)) return;
      if (error) throw error;
      if (!data.session) {
        const link = document.createElement('a');
        link.href = authUrl(BASE, 'login', `${location.pathname}${location.search}`);
        link.textContent = t('Войдите, чтобы читать сообщения');
        status.replaceChildren(link);
        return;
      }
      owner = data.session.user.id;
      client = supabase;
      const conversation = await dmConversation(conversationId);
      if (!current(turn)) return;
      if (!conversation) { status.textContent = t('Диалог не найден'); return; }
      head.replaceChildren(conversation.other ? renderAuthor(conversation.other, BASE) : document.createTextNode(t('Удалённый пользователь')));
      form.hidden = !conversation.can_send;
      closed.hidden = conversation.can_send;
      const rows = await dmMessages(conversationId, null, 30);
      if (!current(turn)) return;
      rows.slice().reverse().forEach((message) => addMessage(message, turn));
      syncedId = rows[0]?.id ?? 0;
      hasMore = rows.length === 30;
      syncOlder();
      loaded = true;
      list.scrollTop = list.scrollHeight;
      readIfVisible();
      const nextChannel = supabase.channel(`messages-thread:${conversationId}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          if (!current(turn) || channel !== nextChannel) return;
          const row = payload.new as Record<string, unknown>;
          const id = Number(row.id);
          if (!Number.isSafeInteger(id) || typeof row.created_at !== 'string') return;
          const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
          const added = addMessage({ id, sender_id: typeof row.sender_id === 'string' ? row.sender_id : '', body: typeof row.body === 'string' ? row.body : null, created_at: row.created_at, deleted: row.deleted_at != null }, turn);
          if (added && nearBottom) list.scrollTop = list.scrollHeight;
          if (added && row.sender_id !== owner) readIfVisible();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          if (!current(turn) || channel !== nextChannel) return;
          const row = payload.new as Record<string, unknown>;
          if (row.deleted_at != null) {
            const id = Number(row.id);
            if (!Number.isSafeInteger(id)) return;
            realtimeDeleted.add(id);
            applyMessageState(id, true);
          }
        });
      channel = nextChannel;
      nextChannel.subscribe((state) => {
        if (state === 'SUBSCRIBED' && current(turn) && channel === nextChannel) void refreshLatest(turn, nextChannel);
      });
    } catch (error) {
      if (current(turn)) {
        const message = (error as { message?: unknown })?.message;
        status.textContent = typeof message === 'string' && message.includes('dm:not_found') ? t('Диалог не найден') : t('Не удалось загрузить');
      }
    }
  };
  signal.addEventListener('abort', () => {
    generation++;
    clearSubscription();
    confirmations.forEach((timer) => clearTimeout(timer));
    confirmations.clear();
  }, { once: true });
  older.addEventListener('click', () => { void loadOlder(generation); }, { signal });
  document.addEventListener('visibilitychange', readIfVisible, { signal });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const turn = generation;
    if (!current(turn) || !owner || sending || form.hidden) return;
    const body = textarea.value.trim();
    if (!body) return;
    sending = true;
    textarea.disabled = true;
    submit.disabled = true;
    composeStatus.textContent = '';
    try {
      const rows = await dmSend(conversationId, body);
      if (!current(turn)) return;
      textarea.value = '';
      const message = rows[0];
      if (message) addMessage({ id: message.id, sender_id: owner, body, created_at: message.created_at, deleted: false }, turn);
      list.scrollTop = list.scrollHeight;
    } catch (error) {
      if (current(turn)) composeStatus.textContent = messageError(error);
    } finally {
      if (current(turn)) { sending = false; textarea.disabled = false; submit.disabled = false; }
    }
  }, { signal });
  textarea.addEventListener('compositionstart', () => { composing = true; }, { signal });
  textarea.addEventListener('compositionend', () => { composing = false; }, { signal });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing) {
      event.preventDefault();
      form.requestSubmit();
    }
  }, { signal });
  onSessionChange(() => { textarea.value = ''; void initialize(); }, { signal });
  await initialize();
}

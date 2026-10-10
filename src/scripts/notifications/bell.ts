import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { pageLang } from '../../i18n/client';
import { onPage, cleanup } from '../router';
import { hasSession, onSessionChange } from '../user-data/session';
import { t } from '../search';
import { notificationsList, unreadCount, markRead, notificationText, notificationHref } from './api';

let count = 0;
let userId: string | null = null;
let channel: RealtimeChannel | null = null;
let client: SupabaseClient<any> | null = null;
const listeners = new Set<() => void>();
let sessionRequest = 0;
let countRequest = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

const notifyListeners = () => { for (const listener of listeners) listener(); };

export function onUnreadChange(listener: (count: number) => void, { signal }: { signal?: AbortSignal } = {}): void {
  if (signal?.aborted) return;
  const notify = () => listener(count);
  listeners.add(notify);
  signal?.addEventListener('abort', () => { listeners.delete(notify); }, { once: true });
  notify();
}

export async function refreshCount() {
  const owner = userId;
  if (!owner) return;
  const request = ++countRequest;
  try {
    const next = await unreadCount();
    if (request !== countRequest || userId !== owner) return;
    count = next;
    notifyListeners();
  } catch {}
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void refreshCount();
  }, 300);
}

function setUser(next: string | null) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = undefined;
  countRequest++;
  const previous = channel;
  channel = null;
  if (previous && client) void client.removeChannel(previous);
  userId = next;
  count = 0;
  notifyListeners();
}

async function ensureSubscription() {
  const request = ++sessionRequest;
  if (!hasSession()) { if (userId || channel) setUser(null); return; }
  try {
    const { getSupabase } = await import('../auth');
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (request !== sessionRequest) return;
    client = supabase;
    const next = data.session?.user.id ?? null;
    if (next === userId && channel) { void refreshCount(); return; }
    if (next !== userId || channel) setUser(next);
    if (!next) return;
    const nextChannel = supabase.channel('notifications:' + next)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${next}` }, () => scheduleRefresh());
    channel = nextChannel;
    nextChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && channel === nextChannel) void refreshCount();
    });
    void refreshCount();
  } catch {}
}

void ensureSubscription();
onSessionChange(() => { void ensureSubscription(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshCount();
});

onPage((signal) => {
  const root = document.getElementById('notif');
  const button = document.getElementById('notif-button') as HTMLButtonElement | null;
  const badge = document.getElementById('notif-badge');
  const panel = document.getElementById('notif-panel');
  const list = document.getElementById('notif-list');
  const readAll = document.getElementById('notif-read-all') as HTMLButtonElement | null;
  if (!root || !button || !badge || !panel || !list || !readAll) return;
  let pageUser = userId;
  let pageCount = count;
  let listRequest = 0;
  const close = (restore = false) => {
    listRequest++;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restore) button.focus({ preventScroll: true });
  };
  const renderState = () => {
    const countChanged = pageCount !== count;
    pageCount = count;
    if (pageUser !== userId) {
      pageUser = userId;
      close();
      list.replaceChildren();
    }
    root.hidden = !userId;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    button.setAttribute('aria-label', `${t('Уведомления')}${count ? ` (${count})` : ''}`);
    if (countChanged && !panel.hidden) {
      listRequest++;
      void load();
    }
  };

  const showMessage = (message: string) => {
    const empty = document.createElement('p');
    empty.className = 'notif-empty';
    empty.textContent = message;
    list.replaceChildren(empty);
  };
  const load = async () => {
    const request = ++listRequest;
    const owner = userId;
    const focusedId = list.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id
      : undefined;
    const restoreFocus = () => {
      if (focusedId === undefined) return;
      const item = Array.from(list.querySelectorAll<HTMLElement>('[data-id]'))
        .find((item) => item.dataset.id === focusedId);
      (item ?? readAll).focus({ preventScroll: true });
    };
    if (focusedId === undefined) list.replaceChildren();
    try {
      const rows = await notificationsList(null, 10);
      if (signal.aborted || panel.hidden || request !== listRequest || userId !== owner) return;
      if (!rows.length) {
        showMessage(t('Уведомлений пока нет'));
        restoreFocus();
        return;
      }
      const fragment = document.createDocumentFragment();
      const base = /^\/(en|es)(?=\/|$)/.exec(location.pathname)?.[0] || '';
      for (const row of rows) {
        const href = notificationHref(row, base);
        const item = document.createElement(href ? 'a' : 'button');
        item.className = `notif-item${row.read_at ? '' : ' unread'}`;
        item.dataset.id = String(row.id);
        if (href) item.setAttribute('href', href);
        else item.setAttribute('type', 'button');
        const title = document.createElement('span');
        title.textContent = notificationText(row);
        item.append(title);
        if (row.snippet) {
          const snippet = document.createElement('span');
          snippet.className = 'notif-snippet';
          snippet.textContent = row.snippet;
          item.append(snippet);
        }
        const time = document.createElement('time');
        time.dateTime = row.created_at;
        time.textContent = new Date(row.created_at).toLocaleString(pageLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        item.append(time);
        if (!row.read_at) {
          let marking = false;
          item.addEventListener('click', () => {
            if (marking || !item.classList.contains('unread')) return;
            marking = true;
            void markRead([row.id]).then(() => {
              if (userId !== owner) return;
              item.classList.remove('unread');
              listRequest++;
              if (!signal.aborted && !panel.hidden) void load();
              void refreshCount();
            }).catch(() => { marking = false; });
          }, { signal });
        }
        fragment.append(item);
      }
      list.replaceChildren(fragment);
      restoreFocus();
    } catch {
      if (!signal.aborted && !panel.hidden && request === listRequest && userId === owner) {
        showMessage(t('Не удалось загрузить'));
        restoreFocus();
      }
    }
  };
  listeners.add(renderState);
  cleanup(signal, () => { listeners.delete(renderState); close(); });
  renderState();

  button.addEventListener('click', () => {
    const open = panel.hidden;
    if (!open) { close(); return; }
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    void load();
  }, { signal });
  panel.addEventListener('click', (event) => { if ((event.target as Element).closest('.notif-all')) close(); }, { signal });
  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target as Node)) close();
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(true); }
  }, { signal });
  readAll.addEventListener('click', async () => {
    if (readAll.disabled) return;
    const owner = userId;
    readAll.disabled = true;
    try {
      await markRead(null);
      if (userId !== owner) return;
      list.querySelectorAll('.notif-item.unread').forEach((item) => item.classList.remove('unread'));
      listRequest++;
      if (!signal.aborted && !panel.hidden) void load();
      void refreshCount();
    } catch {} finally { readAll.disabled = false; }
  }, { signal });
});

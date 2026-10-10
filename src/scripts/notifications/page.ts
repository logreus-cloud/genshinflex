import { pageLang } from '../../i18n/client';
import { renderAuthor } from '../forum/author';
import { BASE, t } from '../search';
import { hasSession, onSessionChange } from '../user-data/session';
import { onUnreadChange, refreshCount } from './bell';
import { notificationsList, markRead, notificationText, notificationHref, type NotificationItem } from './api';

export async function initNotifications(root: HTMLElement, signal: AbortSignal) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const readAll = root.querySelector<HTMLButtonElement>('[data-read-all]')!;
  const fresh = root.querySelector<HTMLButtonElement>('[data-fresh]')!;
  let generation = 0;
  let busy = false;
  let before: number | null = null;
  let hasMore = false;
  let unread = 0;
  let signedIn = false;
  let readingAll = false;
  let previousCount: number | null = null;
  let readAllVersion = 0;
  let newestId: number | null = null;
  let firstPageLoaded = false;
  let checkingFresh = false;
  let checkAgain = false;
  const current = (turn: number) => !signal.aborted && turn === generation;
  const syncControls = () => {
    more.hidden = !hasMore;
    more.disabled = busy || !hasMore;
    readAll.hidden = !signedIn || (unread === 0 && !list.querySelector('.unread'));
    readAll.disabled = readingAll;
    fresh.disabled = readingAll;
  };
  const render = (row: NotificationItem, turn: number, readAll: boolean) => {
    const isRead = !!row.read_at || readAll;
    const item = document.createElement('div');
    item.className = `panel notif-row${isRead ? '' : ' unread'}`;
    item.dataset.id = String(row.id);
    const person = document.createElement('div');
    person.className = 'notif-person';
    const date = document.createElement('time');
    date.dateTime = row.created_at;
    date.className = 'small muted';
    date.textContent = new Date(row.created_at).toLocaleString(pageLang(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    person.append(renderAuthor(row.actor, BASE), date);
    const href = notificationHref(row, BASE);
    const text = document.createElement(href ? 'a' : 'span');
    text.textContent = notificationText(row);
    if (href) text.setAttribute('href', href);
    let marking = false;
    let markButton: HTMLButtonElement | null = null;
    const mark = async () => {
      if (marking || !item.classList.contains('unread')) return;
      marking = true;
      try {
        await markRead([row.id]);
        void refreshCount();
        if (!current(turn)) return;
        item.classList.remove('unread');
        markButton?.remove();
        syncControls();
      } catch {
        if (current(turn)) status.textContent = t('Не удалось загрузить');
      } finally { marking = false; }
    };
    if (href && !isRead) text.addEventListener('click', () => { void mark(); }, { signal });
    item.append(person, text);
    if (row.snippet) {
      const snippet = document.createElement('p');
      snippet.className = 'muted';
      snippet.textContent = row.snippet;
      item.append(snippet);
    }
    if (!isRead) {
      markButton = document.createElement('button');
      markButton.className = 'btn small notif-mark';
      markButton.type = 'button';
      markButton.textContent = t('Отметить прочитанным');
      markButton.addEventListener('click', () => { void mark(); }, { signal });
      item.append(markButton);
    }
    return item;
  };
  const load = async (turn: number) => {
    if (!current(turn) || busy) return;
    busy = true;
    syncControls();
    status.textContent = '';
    const readAllAtStart = readAllVersion;
    try {
      const rows = await notificationsList(before, 31);
      if (!current(turn)) return;
      if (before === null) {
        newestId = rows[0]?.id ?? null;
        firstPageLoaded = true;
      }
      const visible = rows.slice(0, 30);
      if (visible.length) {
        list.append(...visible.map((row) => render(row, turn, readAllVersion !== readAllAtStart)));
        before = visible[visible.length - 1].id;
      } else if (!list.childElementCount) {
        const empty = document.createElement('p');
        empty.textContent = t('Уведомлений пока нет');
        list.replaceChildren(empty);
      }
      hasMore = rows.length > 30;
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    } finally {
      if (current(turn)) { busy = false; syncControls(); }
    }
  };
  const checkFresh = async (turn: number) => {
    if (checkingFresh) { checkAgain = true; return; }
    checkingFresh = true;
    try {
      do {
        checkAgain = false;
        const rows = await notificationsList(null, 1);
        if (!current(turn)) return;
        if (rows.length && (newestId === null || rows[0].id > newestId)) {
          fresh.hidden = false;
          return;
        }
      } while (checkAgain);
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    } finally {
      if (current(turn)) checkingFresh = false;
    }
  };
  const initialize = async () => {
    const turn = ++generation;
    busy = false;
    before = null;
    hasMore = false;
    signedIn = false;
    readingAll = false;
    readAllVersion = 0;
    newestId = null;
    firstPageLoaded = false;
    checkingFresh = false;
    checkAgain = false;
    fresh.hidden = true;
    list.replaceChildren();
    status.replaceChildren();
    syncControls();
    try {
      const stored = hasSession();
      const { authUrl, getSupabase } = await import('../auth');
      if (!current(turn)) return;
      const { data, error } = stored ? await getSupabase().auth.getSession() : { data: { session: null }, error: null };
      if (!current(turn)) return;
      if (error) throw error;
      if (!data.session) {
        const link = document.createElement('a');
        link.href = authUrl(BASE, 'login', location.pathname);
        link.textContent = t('Войдите, чтобы видеть уведомления');
        status.replaceChildren(link);
        return;
      }
      signedIn = true;
      syncControls();
      await load(turn);
      if (!current(turn)) return;
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    }
  };
  more.addEventListener('click', () => { if (!busy && hasMore) void load(generation); }, { signal });
  fresh.addEventListener('click', () => { if (!readingAll) void initialize(); }, { signal });
  readAll.addEventListener('click', async () => {
    if (readAll.disabled || !signedIn) return;
    const turn = generation;
    readingAll = true;
    syncControls();
    try {
      await markRead(null);
      if (turn === generation) readAllVersion++;
      void refreshCount();
      if (!current(turn)) return;
      list.querySelectorAll<HTMLElement>('.notif-row.unread').forEach((item) => {
        item.classList.remove('unread');
        item.querySelector('.notif-mark')?.remove();
      });
      unread = 0;
      syncControls();
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    } finally {
      if (current(turn)) { readingAll = false; syncControls(); }
    }
  }, { signal });
  onUnreadChange((next) => {
    const grew = signedIn && firstPageLoaded && previousCount !== null && next > previousCount;
    previousCount = next;
    unread = next;
    syncControls();
    if (grew && fresh.hidden) void checkFresh(generation);
  }, { signal });
  onSessionChange(() => { previousCount = null; void initialize(); }, { signal });
  await initialize();
}

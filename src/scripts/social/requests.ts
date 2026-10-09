import { pageLang } from '../../i18n/client';
import { renderAuthor } from '../forum/author';
import { BASE, t } from '../search';
import { hasSession, onSessionChange } from '../user-data/session';
import { friendRemove, friendRespond, socialErrorText, socialRequests, type SocialRequest } from './api';

type Direction = 'incoming' | 'outgoing';

export async function initFriendRequests(root: HTMLElement, signal: AbortSignal) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const tabs = root.querySelector<HTMLElement>('[data-tabs]')!;
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const buttons = { incoming: root.querySelector<HTMLButtonElement>('[data-tab="incoming"]')!, outgoing: root.querySelector<HTMLButtonElement>('[data-tab="outgoing"]')! };
  const counts = { incoming: root.querySelector<HTMLElement>('[data-count="incoming"]')!, outgoing: root.querySelector<HTMLElement>('[data-count="outgoing"]')! };
  let tab: Direction = location.hash === '#outgoing' ? 'outgoing' : 'incoming';
  let generation = 0;
  let busy = false;
  let offset = 0;
  let hasMore = false;
  const current = (turn: number) => !signal.aborted && turn === generation;
  const empty = (direction: Direction) => direction === 'incoming' ? t('Входящих заявок нет') : t('Исходящих заявок нет');
  const setCount = (direction: Direction, value: number) => {
    counts[direction].textContent = value ? `(${value > 30 ? '30+' : value})` : '';
  };
  const selectTab = () => {
    for (const direction of ['incoming', 'outgoing'] as const) {
      buttons[direction].setAttribute('aria-selected', String(tab === direction));
    }
  };
  const syncControls = () => {
    for (const direction of ['incoming', 'outgoing'] as const) buttons[direction].disabled = busy;
    for (const button of list.querySelectorAll<HTMLButtonElement>('.friend-request-actions button')) button.disabled = busy;
    more.hidden = !hasMore;
    more.disabled = busy || !hasMore;
  };
  const setBusy = (value: boolean) => {
    busy = value;
    syncControls();
  };
  const fetchRows = async (direction: Direction, target: number, turn: number) => {
    const rows: SocialRequest[] = [];
    let firstCount = 0;
    let hasNext = false;
    while (rows.length < target) {
      const limit = Math.min(30, target - rows.length);
      const page = await socialRequests(direction, limit + 1, rows.length);
      if (!current(turn)) return null;
      if (!rows.length) firstCount = page.length;
      rows.push(...page.slice(0, limit));
      hasNext = page.length > limit;
      if (!hasNext) break;
    }
    return { rows, hasNext, firstCount };
  };
  const loadOtherCount = async (direction: Direction, active: Direction, turn: number) => {
    try {
      const rows = await socialRequests(direction, 31);
      if (current(turn) && tab === active) setCount(direction, rows.length);
    } catch {
      if (current(turn) && tab === active) setCount(direction, 0);
    }
  };
  const render = (row: SocialRequest, direction: Direction, turn: number) => {
    const item = document.createElement('div');
    item.className = 'panel friend-request';
    const person = document.createElement('div');
    person.className = 'friend-request-person';
    const date = document.createElement('time');
    date.dateTime = row.created_at;
    date.className = 'small muted';
    date.textContent = new Date(row.created_at).toLocaleDateString(pageLang(), { day: 'numeric', month: 'short', year: 'numeric' });
    person.append(renderAuthor(row.author, BASE), date);
    const actions = document.createElement('div');
    actions.className = 'friend-request-actions';
    const addAction = (label: string, action: () => Promise<void>, primary = false, accepted = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'btn primary' : 'btn';
      button.textContent = label;
      button.addEventListener('click', async () => {
        if (busy || !current(turn)) return;
        const target = Math.max(30, offset);
        setBusy(true);
        status.textContent = '';
        let completed = false;
        try {
          await action();
          if (!current(turn)) return;
          completed = true;
          list.replaceChildren();
          offset = 0;
          hasMore = false;
          syncControls();
          const result = await fetchRows(direction, target, turn);
          if (!result || !current(turn)) return;
          const other: Direction = direction === 'incoming' ? 'outgoing' : 'incoming';
          setCount(direction, result.firstCount);
          showRows(result.rows, direction, turn, result.hasNext);
          if (accepted) status.textContent = t('Теперь вы друзья');
          void loadOtherCount(other, direction, turn);
        } catch (error) {
          if (current(turn)) status.textContent = completed ? t('Не удалось загрузить') : socialErrorText(error);
        } finally {
          if (current(turn)) setBusy(false);
        }
      }, { signal });
      actions.append(button);
    };
    if (direction === 'incoming') {
      addAction(t('Принять'), () => friendRespond(row.user_id, true), true, true);
      addAction(t('Отклонить'), () => friendRespond(row.user_id, false));
    } else addAction(t('Отменить заявку'), () => friendRemove(row.user_id));
    item.append(person, actions);
    return item;
  };
  const showRows = (rows: SocialRequest[], direction: Direction, turn: number, hasNext: boolean) => {
    if (rows.length) list.replaceChildren(...rows.map((row) => render(row, direction, turn)));
    else {
      const message = document.createElement('p');
      message.textContent = empty(direction);
      list.replaceChildren(message);
    }
    offset = rows.length;
    hasMore = hasNext;
    syncControls();
  };
  const loadList = async (reset = false) => {
    if (busy) return;
    const turn = generation;
    const direction = tab;
    setBusy(true);
    status.textContent = '';
    if (reset) {
      list.replaceChildren();
      offset = 0;
      hasMore = false;
      syncControls();
    }
    try {
      const rows = await socialRequests(direction, 31, offset);
      if (!current(turn)) return;
      if (reset) {
        setCount(direction, rows.length);
        showRows(rows.slice(0, 30), direction, turn, rows.length > 30);
      }
      else {
        list.append(...rows.slice(0, 30).map((row) => render(row, direction, turn)));
        offset += Math.min(rows.length, 30);
        hasMore = rows.length > 30;
        syncControls();
      }
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    } finally {
      if (current(turn)) setBusy(false);
    }
  };
  const initialize = async () => {
    const turn = ++generation;
    tab = location.hash === '#outgoing' ? 'outgoing' : 'incoming';
    busy = false;
    offset = 0;
    hasMore = false;
    let authenticated = false;
    tabs.hidden = true;
    list.replaceChildren();
    status.replaceChildren();
    setCount('incoming', 0);
    setCount('outgoing', 0);
    selectTab();
    syncControls();
    setBusy(true);
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
        link.textContent = t('Войдите, чтобы видеть заявки в друзья');
        status.replaceChildren(link);
        return;
      }
      authenticated = true;
      const result = await fetchRows(tab, 30, turn);
      if (!result || !current(turn)) return;
      const other: Direction = tab === 'incoming' ? 'outgoing' : 'incoming';
      setCount(tab, result.firstCount);
      showRows(result.rows, tab, turn, result.hasNext);
      tabs.hidden = false;
      void loadOtherCount(other, tab, turn);
    } catch {
      if (current(turn)) {
        if (authenticated) tabs.hidden = false;
        status.textContent = t('Не удалось загрузить');
      }
    } finally {
      if (current(turn)) setBusy(false);
    }
  };
  buttons.incoming.addEventListener('click', () => {
    if (busy) return;
    tab = 'incoming';
    selectTab();
    const url = new URL(location.href);
    url.hash = '';
    history.replaceState(history.state, '', url);
    void loadList(true);
  }, { signal });
  buttons.outgoing.addEventListener('click', () => {
    if (busy) return;
    tab = 'outgoing';
    selectTab();
    const url = new URL(location.href);
    url.hash = 'outgoing';
    history.replaceState(history.state, '', url);
    void loadList(true);
  }, { signal });
  more.addEventListener('click', () => { if (!busy && hasMore) void loadList(); }, { signal });
  onSessionChange(() => { void initialize(); }, { signal });
  await initialize();
}

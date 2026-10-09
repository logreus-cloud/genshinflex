import { pageLang } from '../../i18n/client';
import { threadHref } from '../../lib/forum';
import { renderAuthor } from '../forum/author';
import { plainSnippet } from '../forum/markup';
import { BASE, t } from '../search';
import { hasSession, onSessionChange } from '../user-data/session';
import { socialFeed, type FeedItem } from './api';

export async function initFeed(root: HTMLElement, signal: AbortSignal) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  let generation = 0;
  let busy = false;
  let before: { at: string; id: number } | null = null;
  let hasMore = false;
  const current = (turn: number) => !signal.aborted && turn === generation;
  const syncControls = () => {
    more.hidden = !hasMore;
    more.disabled = busy || !hasMore;
  };
  const render = (row: FeedItem) => {
    const item = document.createElement('div');
    item.className = 'panel feed-item';
    const person = document.createElement('div');
    person.className = 'feed-item-person';
    const date = document.createElement('time');
    date.dateTime = row.created_at;
    date.className = 'small muted';
    date.textContent = new Date(row.created_at).toLocaleDateString(pageLang(), { day: 'numeric', month: 'short', year: 'numeric' });
    person.append(renderAuthor(row.author, BASE), date);
    const link = document.createElement('a');
    link.href = `${threadHref(BASE, row.thread_id)}#p${row.id}`;
    link.textContent = row.is_thread
      ? t('Новая тема: {title}', { title: row.thread_title })
      : t('Ответ в теме «{title}»', { title: row.thread_title });
    const snippet = document.createElement('p');
    snippet.textContent = plainSnippet(row.body, 200);
    item.append(person, link, snippet);
    return item;
  };
  const load = async (turn: number) => {
    if (!current(turn) || busy) return;
    busy = true;
    syncControls();
    status.textContent = '';
    try {
      const rows = await socialFeed(before, 21);
      if (!current(turn)) return;
      const visible = rows.slice(0, 20);
      if (visible.length) {
        list.append(...visible.map(render));
        const last = visible[visible.length - 1];
        before = { at: last.created_at, id: last.id };
      } else if (!list.childElementCount) {
        const empty = document.createElement('p');
        empty.textContent = t('В ленте пока ничего нет. Подпишитесь на авторов, чтобы видеть их темы и посты.');
        list.replaceChildren(empty);
      }
      hasMore = rows.length > 20;
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    } finally {
      if (current(turn)) { busy = false; syncControls(); }
    }
  };
  const initialize = async () => {
    const turn = ++generation;
    busy = false;
    before = null;
    hasMore = false;
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
        link.textContent = t('Войдите, чтобы видеть ленту подписок');
        status.replaceChildren(link);
        return;
      }
      await load(turn);
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    }
  };
  more.addEventListener('click', () => { if (!busy && hasMore) void load(generation); }, { signal });
  onSessionChange(() => { void initialize(); }, { signal });
  await initialize();
}

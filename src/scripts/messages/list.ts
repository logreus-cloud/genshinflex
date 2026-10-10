import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { pageLang } from '../../i18n/client';
import { renderAuthor } from '../forum/author';
import { BASE, t } from '../search';
import { hasSession, onSessionChange } from '../user-data/session';
import { dmConversations, type Conversation } from './api';

export async function initConversationList(root: HTMLElement, signal: AbortSignal) {
  if (signal.aborted) return;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  let generation = 0;
  let busy = false;
  let refreshPending = false;
  let before: { at: string; id: number } | null = null;
  let hasMore = false;
  let userId: string | null = null;
  let channel: RealtimeChannel | null = null;
  let client: SupabaseClient<any> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const current = (turn: number) => !signal.aborted && turn === generation;
  const syncControls = () => {
    more.hidden = !hasMore;
    more.disabled = busy || !hasMore;
  };
  const clearSubscription = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    const previous = channel;
    const supabase = client;
    channel = null;
    client = null;
    userId = null;
    if (previous && supabase) void supabase.removeChannel(previous);
  };
  const resetList = () => {
    const turn = ++generation;
    busy = false;
    refreshPending = false;
    before = null;
    hasMore = false;
    list.replaceChildren();
    status.replaceChildren();
    syncControls();
    return turn;
  };
  const render = (row: Conversation) => {
    const item = document.createElement('div');
    item.className = `panel dm-row${row.unread > 0 ? ' unread' : ''}`;
    const person = document.createElement('div');
    person.className = 'dm-person';
    const date = document.createElement('time');
    date.dateTime = row.last_message_at;
    date.className = 'small muted';
    date.textContent = new Date(row.last_message_at).toLocaleString(pageLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    person.append(renderAuthor(row.other, BASE), date);
    const summary = document.createElement('div');
    summary.className = 'dm-summary';
    const link = document.createElement('a');
    link.className = 'dm-open';
    link.href = `${BASE}/messages/?c=${row.id}`;
    if (row.last_body === null) {
      const deleted = document.createElement('em');
      deleted.className = 'muted';
      deleted.textContent = t('Сообщение удалено');
      link.append(deleted);
    } else {
      link.textContent = row.last_sender_is_me ? `${t('Вы:')} ${row.last_body}` : row.last_body;
    }
    summary.append(link);
    if (row.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'dm-badge';
      badge.textContent = String(row.unread);
      summary.append(badge);
    }
    item.append(person, summary);
    return item;
  };
  const load = async (turn: number, first = false) => {
    if (!current(turn) || busy) return;
    busy = true;
    syncControls();
    status.textContent = '';
    try {
      const rows = await dmConversations(first ? null : before, 21);
      if (!current(turn)) return;
      const visible = rows.slice(0, 20);
      if (first) before = null;
      if (visible.length) {
        if (first) list.replaceChildren(...visible.map(render));
        else list.append(...visible.map(render));
        const last = visible[visible.length - 1];
        before = { at: last.last_message_at, id: last.id };
      } else if (first || !list.childElementCount) {
        const empty = document.createElement('p');
        empty.textContent = t('Сообщений пока нет. Написать можно с публичной страницы профиля.');
        list.replaceChildren(empty);
      }
      hasMore = rows.length > 20;
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    } finally {
      if (current(turn)) {
        busy = false;
        syncControls();
        if (refreshPending) refreshFirst(turn);
      }
    }
  };
  const refreshFirst = (turn: number) => {
    if (!current(turn)) return;
    if (busy) { refreshPending = true; return; }
    refreshPending = false;
    void load(turn, true);
  };
  const scheduleRefresh = (owner: string, source: RealtimeChannel, turn: number) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (channel === source && userId === owner && current(turn)) refreshFirst(turn);
    }, 500);
  };
  const initialize = async () => {
    const turn = resetList();
    clearSubscription();
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
        link.href = authUrl(BASE, 'login', location.pathname);
        link.textContent = t('Войдите, чтобы читать сообщения');
        status.replaceChildren(link);
        return;
      }
      const owner = data.session.user.id;
      userId = owner;
      client = supabase;
      const nextChannel = supabase.channel(`messages:${owner}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, () => {
          if (channel === nextChannel && userId === owner && current(turn)) scheduleRefresh(owner, nextChannel, turn);
        });
      channel = nextChannel;
      nextChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED' && channel === nextChannel && userId === owner && current(turn)) refreshFirst(turn);
      });
      await load(turn);
    } catch {
      if (current(turn)) status.textContent = t('Не удалось загрузить');
    }
  };
  signal.addEventListener('abort', () => {
    generation++;
    clearSubscription();
  }, { once: true });
  more.addEventListener('click', () => { if (!busy && hasMore) void load(generation); }, { signal });
  onSessionChange(() => { void initialize(); }, { signal });
  await initialize();
}

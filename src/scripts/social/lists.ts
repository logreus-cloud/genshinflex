import { renderAuthor } from '../forum/author';
import { BASE, t } from '../search';
import { socialList, type SocialCounts, type SocialListKind } from './api';

const labels: Record<SocialListKind, string> = { followers: 'Подписчики', following: 'Подписки', friends: 'Друзья' };

export function initConnections(root: HTMLElement, profileId: string, signal: AbortSignal): { setCounts(counts: SocialCounts | null): void; countsUnavailable(): void; reload(kind?: SocialListKind): void } {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('#public-social-counts [data-kind]')];
  const countsBox = root.querySelector<HTMLElement>('#public-social-counts')!;
  const card = root.querySelector<HTMLElement>('#public-connections')!;
  const title = root.querySelector<HTMLElement>('#public-connections-title')!;
  const list = root.querySelector<HTMLElement>('#public-connections-list')!;
  const status = root.querySelector<HTMLElement>('#public-connections-status')!;
  const more = root.querySelector<HTMLButtonElement>('#public-connections-more')!;
  let active: SocialListKind | null = null;
  let offset = 0;
  let loading = false;
  let failed = false;
  let request = 0;
  let listsHidden = false;
  let countsReady = false;

  const current = (turn: number, kind: SocialListKind) => !signal.aborted && turn === request && active === kind;
  const select = () => {
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.kind === active));
  };
  const setHash = (kind: SocialListKind | null) => {
    const url = new URL(location.href);
    if (kind) url.hash = kind;
    else if (url.hash === `#${active}`) url.hash = '';
    history.replaceState(history.state, '', url);
  };
  const reset = () => {
    ++request;
    loading = false;
    failed = false;
    offset = 0;
    list.replaceChildren();
    status.textContent = '';
    more.hidden = true;
    if (listsHidden) status.textContent = t('Пользователь скрыл эти списки');
    else void load();
  };
  async function load() {
    if (!active || loading || !countsReady || listsHidden || signal.aborted) return;
    const kind = active, turn = ++request;
    loading = true;
    more.disabled = true;
    status.textContent = '';
    try {
      const rows = await socialList(profileId, kind, 31, offset);
      if (!current(turn, kind)) return;
      for (const row of rows.slice(0, 30)) {
        const item = document.createElement('div');
        item.className = 'connection';
        item.append(renderAuthor(row.author, BASE));
        list.append(item);
      }
      failed = false;
      offset += Math.min(rows.length, 30);
      more.hidden = rows.length <= 30;
      if (!offset) status.textContent = t('Здесь пока никого нет');
    } catch {
      if (!current(turn, kind)) return;
      failed = true;
      status.textContent = t('Не удалось загрузить');
    } finally {
      if (current(turn, kind)) {
        loading = false;
        more.disabled = false;
      }
    }
  }
  const open = (kind: SocialListKind) => {
    ++request;
    loading = false;
    active = kind;
    select();
    card.hidden = false;
    title.textContent = t(labels[kind]);
    setHash(kind);
    reset();
  };
  const close = () => {
    ++request;
    loading = false;
    setHash(null);
    active = null;
    select();
    card.hidden = true;
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const kind = tab.dataset.kind as SocialListKind;
      if (active === kind) {
        if (failed) reset();
        else close();
      } else open(kind);
    }, { signal });
  }
  more.addEventListener('click', () => { void load(); }, { signal });

  const initial = location.hash.slice(1);
  if (initial === 'followers' || initial === 'following' || initial === 'friends') open(initial);

  return {
    setCounts(counts: SocialCounts | null) {
      countsBox.hidden = !counts;
      for (const tab of tabs) tab.querySelector<HTMLElement>('[data-count]')!.textContent = counts ? String(counts[tab.dataset.kind as SocialListKind]) : '';
      const changed = countsReady !== !!counts || (!!counts && listsHidden !== counts.lists_hidden);
      countsReady = !!counts;
      listsHidden = counts?.lists_hidden === true;
      if (changed && active) reset();
    },
    // Счётчики не загрузились: открываем списки без них — скрытые база всё равно не отдаст.
    countsUnavailable() {
      if (countsReady) return;
      countsReady = true;
      listsHidden = false;
      if (active) reset();
    },
    reload(kind?: SocialListKind) {
      if (active && (!kind || active === kind)) reset();
    },
  };
}

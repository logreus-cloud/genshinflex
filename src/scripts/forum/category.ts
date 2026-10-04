import { PAGE_SIZE, threadHref } from '../../lib/forum';
import { pageLang } from '../../i18n/client';
import { BASE, t } from '../search';
import { forumMe, forumThreads, forumErrorText } from './api';
import { renderAuthor } from './author';

export async function initForumCategory(root: HTMLElement, signal: AbortSignal) {
  const category = root.dataset.category!;
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const select = root.querySelector<HTMLSelectElement>('[data-lang]')!;
  const create = root.querySelector<HTMLElement>('[data-create]')!;
  let offset = 0;
  let busy = false;

  try {
    const saved = localStorage.getItem('forum-lang');
    if (saved && [...select.options].some((option) => option.value === saved)) select.value = saved;
  } catch { /* Хранилище может быть недоступно */ }

  try {
    const me = await forumMe();
    if (signal.aborted) return;
    if (category === 'announcements' && !me?.moderator) create.hidden = true;
  } catch {
    if (category === 'announcements') create.hidden = true;
  }

  const load = async (reset = false) => {
    if (busy) return;
    busy = true;
    more.disabled = true;
    if (reset) {
      offset = 0;
      list.replaceChildren();
    }
    try {
      const rows = await forumThreads(category, select.value || null, PAGE_SIZE, offset);
      if (signal.aborted) return;
      for (const row of rows) {
        const card = document.createElement('article');
        card.className = `panel forum-thread${row.deleted ? ' muted' : ''}`;
        const link = document.createElement('a');
        link.href = threadHref(BASE, row.id);
        link.textContent = `${row.pinned ? '📌 ' : ''}${row.locked ? '🔒 ' : ''}${row.title}`;
        card.append(link, renderAuthor(row.author, BASE));

        const meta = document.createElement('span');
        meta.className = 'small muted';
        const seconds = Math.round((Date.parse(row.last_post_at) - Date.now()) / 1000);
        const unit: Intl.RelativeTimeFormatUnit = Math.abs(seconds) < 3600
          ? 'minute' : Math.abs(seconds) < 86400 ? 'hour' : 'day';
        const divisor = unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86400;
        const time = new Intl.RelativeTimeFormat(pageLang(), { numeric: 'auto' })
          .format(Math.round(seconds / divisor), unit);
        meta.textContent = `${row.lang.toUpperCase()} · ${t('Ответов: {n}', {
          n: Math.max(0, row.post_count - 1),
        })} · ${t('Последний ответ {time}', { time })}`;
        card.append(meta);
        list.append(card);
      }
      offset += rows.length;
      more.hidden = rows.length < PAGE_SIZE;
      if (!offset) list.textContent = t('Пока пусто');
    } catch (error) {
      if (!signal.aborted) list.textContent = forumErrorText(error);
    } finally {
      busy = false;
      if (!signal.aborted) more.disabled = false;
    }
  };

  select.addEventListener('change', () => {
    try {
      localStorage.setItem('forum-lang', select.value);
    } catch { /* Хранилище может быть недоступно */ }
    void load(true);
  }, { signal });
  more.addEventListener('click', () => void load(), { signal });
  void load();
}

import { FORUM_CATEGORIES, categoryHref, threadHref } from '../../lib/forum';
import { BASE, t } from '../search';
import { forumCategoryStats, forumThreads, forumErrorText } from './api';

export async function initForumIndex(root: HTMLElement, signal: AbortSignal) {
  const categories = root.querySelector<HTMLElement>('[data-categories]')!;
  const recent = root.querySelector<HTMLElement>('[data-recent]')!;
  try {
    const [stats, threads] = await Promise.all([forumCategoryStats(), forumThreads(null, null, 15)]);
    if (signal.aborted) return;
    const bySlug = new Map(stats.map((row) => [row.slug, row]));
    categories.replaceChildren();
    recent.replaceChildren();

    for (const category of FORUM_CATEGORIES) {
      const row = bySlug.get(category.slug);
      const card = document.createElement('a');
      card.className = 'panel forum-category';
      card.href = categoryHref(BASE, category.slug);

      const name = document.createElement('strong');
      name.textContent = `${category.icon} ${t(category.label)}`;
      const description = document.createElement('span');
      description.className = 'muted';
      description.textContent = t(category.description);
      const count = document.createElement('span');
      count.className = 'small';
      count.textContent = t('Тем: {threads} · сообщений: {posts}', {
        threads: row?.thread_count ?? 0,
        posts: row?.post_count ?? 0,
      });
      card.append(name, description, count);

      if (row?.last_thread_id) {
        const last = document.createElement('span');
        last.className = 'small';
        last.textContent = `${t('Последняя тема')}: ${row.last_thread_title}`;
        card.append(last);
      }
      categories.append(card);
    }

    for (const thread of threads) {
      const link = document.createElement('a');
      link.className = 'panel forum-thread';
      link.href = threadHref(BASE, thread.id);
      link.textContent = `${thread.pinned ? '📌 ' : ''}${thread.locked ? '🔒 ' : ''}${thread.title}`;
      recent.append(link);
    }
    if (!threads.length) recent.textContent = t('Пока пусто');
  } catch (error) {
    if (!signal.aborted) recent.textContent = forumErrorText(error);
  }
}

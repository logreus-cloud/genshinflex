import { threadHref } from '../../lib/forum';
import { BASE, t } from '../search';
import { ban, deletePost, forumErrorText, forumMe, forumReportsQueue, resolveReport, unban } from './api';
import { renderAuthor } from './author';
import { plainSnippet } from './markup';

function button(label: string) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'btn small';
  node.textContent = label;
  return node;
}

export async function initForumModeration(root: HTMLElement, signal: AbortSignal) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const select = root.querySelector<HTMLSelectElement>('[data-filter]')!;
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  let selected: string | null = null;
  const openBan = (id: string) => {
    selected = id;
    dialog.showModal();
  };
  root.addEventListener('gf:ban-author', (event) => {
    const id = (event as CustomEvent<{ id: string }>).detail?.id;
    if (id) openBan(id);
  }, { signal });

  try {
    const me = await forumMe();
    if (signal.aborted) return;
    if (!me?.moderator) {
      status.textContent = t('Недостаточно прав');
      return;
    }
  } catch (error) {
    status.textContent = forumErrorText(error);
    return;
  }

  const load = async () => {
    try {
      const rows = await forumReportsQueue(select.value);
      if (signal.aborted) return;
      list.replaceChildren();
      for (const row of rows) {
        const card = document.createElement('article');
        card.className = 'panel forum-report';
        const link = document.createElement('a');
        link.href = `${threadHref(BASE, row.thread_id)}#p${row.post_id}`;
        link.textContent = row.thread_title;
        card.append(link, renderAuthor(row.author, BASE));

        const excerpt = document.createElement('p');
        excerpt.textContent = plainSnippet(row.post_body, 300);
        card.append(excerpt);
        const reason = document.createElement('p');
        reason.className = 'small muted';
        reason.textContent = `${row.reason} · ${t('Жалоб: {n}', { n: row.reports_on_post })}${row.comment ? ` · ${row.comment}` : ''}`;
        card.append(reason);
        const actions = document.createElement('div');
        actions.className = 'forum-actions';

        function run(label: string, work: () => Promise<unknown>) {
          const control = button(label);
          control.addEventListener('click', () => {
            void work().then(load).catch((error) => {
              status.textContent = forumErrorText(error);
            });
          }, { signal });
          actions.append(control);
        }

        if (!row.post_deleted) {
          run(t('Удалить пост'), async () => {
            const reason = root.querySelector<HTMLInputElement>('[data-delete-reason]')!.value;
            await deletePost(row.post_id, reason);
          });
        }
        run(t('Отклонить жалобу'), () => resolveReport(row.id, 'dismissed'));
        run(t('Решено'), () => resolveReport(row.id, 'resolved'));
        if (row.author?.id) {
          const control = button(t('Заблокировать автора'));
          control.addEventListener('click', () => {
            openBan(row.author!.id);
          }, { signal });
          actions.append(control);
          run(t('Разблокировать'), () => unban(row.author!.id));
        }
        card.append(actions);
        list.append(card);
      }
      if (!rows.length) list.textContent = t('Пока пусто');
    } catch (error) {
      if (!signal.aborted) status.textContent = forumErrorText(error);
    }
  };
  select.addEventListener('change', () => void load(), { signal });
  dialog.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', () => dialog.close(), { signal });
  dialog.querySelector<HTMLFormElement>('form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selected) return;
    const days = Number(dialog.querySelector<HTMLSelectElement>('select')!.value);
    const until = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
    try {
      await ban(selected, until, dialog.querySelector<HTMLInputElement>('input')!.value);
      dialog.close();
      await load();
      root.dispatchEvent(new Event('gf:moderation-changed'));
    } catch (error) {
      status.textContent = forumErrorText(error);
    }
  }, { signal });
  void load();
}

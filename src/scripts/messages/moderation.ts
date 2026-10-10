import { pageLang } from '../../i18n/client';
import { forumErrorText, forumMe } from '../forum/api';
import { renderAuthor } from '../forum/author';
import { BASE, t } from '../search';
import { dmModerateDelete, dmReportsQueue, dmResolveReport, type DmReport, type DmReportStatus } from './api';

function button(label: string) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'btn small';
  node.textContent = label;
  return node;
}

function reasonText(reason: DmReport['reason']) {
  if (reason === 'spam') return t('Спам');
  if (reason === 'abuse') return t('Оскорбления');
  return t('Другое');
}

export async function initDmModeration(root: HTMLElement, signal: AbortSignal) {
  const status = root.querySelector<HTMLElement>('[data-dm-status]')!;
  const list = root.querySelector<HTMLElement>('[data-dm-list]')!;
  const select = root.querySelector<HTMLSelectElement>('[data-dm-filter]')!;
  const forumRoot = root.closest<HTMLElement>('[data-forum-moderation]');
  const dialog = forumRoot?.querySelector<HTMLDialogElement>('dialog');

  try {
    const me = await forumMe();
    if (signal.aborted || !me?.moderator) return;
  } catch (error) {
    if (!signal.aborted) status.textContent = forumErrorText(error);
    return;
  }

  let generation = 0;
  const load = async () => {
    const turn = ++generation;
    status.textContent = '';
    try {
      const rows = await dmReportsQueue(select.value as DmReportStatus);
      if (signal.aborted || turn !== generation) return;
      list.replaceChildren();
      for (const row of rows) {
        const card = document.createElement('article');
        card.className = 'panel forum-report';
        const title = document.createElement('h3');
        title.textContent = t('Жалоба на личное сообщение');
        const author = document.createElement('div');
        author.append(document.createTextNode(`${t('Автор')}: `), renderAuthor(row.author, BASE));
        const reporter = document.createElement('div');
        reporter.append(document.createTextNode(`${t('Пожаловался')}: `), renderAuthor(row.reporter, BASE));
        const reason = document.createElement('p');
        reason.className = 'small muted';
        reason.textContent = `${reasonText(row.reason)}${row.comment ? ` · ${row.comment}` : ''}`;
        const body = document.createElement('p');
        body.className = 'dm-report-body';
        body.textContent = row.body;
        card.append(title, author, reporter, reason, body);
        if (row.message_deleted) {
          const deleted = document.createElement('p');
          deleted.className = 'small muted';
          deleted.textContent = t('Сообщение удалено');
          card.append(deleted);
        }
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = t('Контекст переписки');
        details.append(summary);
        const context = document.createElement('div');
        context.className = 'dm-context-list';
        for (const message of row.context) {
          const entry = document.createElement('div');
          entry.className = `dm-context-message${message.reported ? ' reported' : ''}`;
          const heading = document.createElement('div');
          heading.className = 'small muted';
          heading.textContent = `${message.sender?.name ?? t('Удалённый пользователь')} · ${new Date(message.created_at).toLocaleString(pageLang())}`;
          const text = document.createElement('p');
          text.className = 'dm-context-body';
          text.textContent = message.body ?? t('Сообщение удалено');
          entry.append(heading, text);
          context.append(entry);
        }
        details.append(context);
        card.append(details);
        const actions = document.createElement('div');
        actions.className = 'forum-actions';
        const run = (label: string, work: () => Promise<unknown>) => {
          const control = button(label);
          control.addEventListener('click', () => {
            control.disabled = true;
            void work().then(load).catch((error) => {
              if (!signal.aborted) status.textContent = forumErrorText(error);
            }).finally(() => { control.disabled = false; });
          }, { signal });
          actions.append(control);
        };
        if (!row.message_deleted) run(t('Удалить сообщение'), () => dmModerateDelete(row.message_id));
        run(t('Отклонить жалобу'), () => dmResolveReport(row.id, 'dismissed'));
        run(t('Решено'), () => dmResolveReport(row.id, 'resolved'));
        if (dialog && row.author?.id) {
          const control = button(t('Заблокировать автора'));
          control.addEventListener('click', () => {
            forumRoot!.dispatchEvent(new CustomEvent('gf:ban-author', { detail: { id: row.author!.id } }));
          }, { signal });
          actions.append(control);
        }
        card.append(actions);
        list.append(card);
      }
      if (!rows.length) list.textContent = t('Пока пусто');
    } catch (error) {
      if (!signal.aborted && turn === generation) status.textContent = forumErrorText(error);
    }
  };
  select.addEventListener('change', () => void load(), { signal });
  forumRoot?.addEventListener('gf:moderation-changed', () => void load(), { signal });
  void load();
}

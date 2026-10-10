import { FORUM_CATEGORIES, PAGE_SIZE, REACTIONS, categoryHref, threadHref, parseSubject, subjectHref } from '../../lib/forum';
import { pageLang } from '../../i18n/client';
import { BASE, t } from '../search';
import { socialBlockedIds } from '../social/api';
import { forumView, createPost, deletePost, editPost, editThread, forumErrorText, forumMe, forumPosts, forumThread, moderateThread, report, restorePost, setReaction, type ForumPost, type ForumThread } from './api';
import { renderAuthor } from './author';
import { renderMarkup } from './markup';

function el(tag: string, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

export async function initForumThread(root: HTMLElement, signal: AbortSignal) {
  const path = location.pathname.match(/\/forum\/t\/(\d+)\/?$/);
  const id = Number(path?.[1] || new URLSearchParams(location.search).get('id'));
  const page = Math.max(1, Number(new URLSearchParams(location.search).get('page')) || 1);
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const heading = root.querySelector<HTMLElement>('[data-heading]')!;
  const postsBox = root.querySelector<HTMLElement>('[data-posts]')!;
  const pager = root.querySelector<HTMLElement>('[data-pages]')!;
  const reply = root.querySelector<HTMLElement>('[data-reply]')!;
  const moderator = root.querySelector<HTMLElement>('[data-moderator]')!;
  if (!Number.isSafeInteger(id) || id < 1) {
    status.textContent = t('Не найдено');
    return;
  }

  let thread: ForumThread;
  let posts: ForumPost[];
  let me: Awaited<ReturnType<typeof forumMe>>;
  let blockedIds: Set<string>;
  let replyTo: number | null = null;
  try {
    const meRequest = forumMe();
    [thread, posts, me, blockedIds] = await Promise.all([
      forumThread(id),
      forumPosts(id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
      meRequest,
      meRequest.then((user) => user ? socialBlockedIds() : new Set<string>()),
    ]) as [ForumThread, ForumPost[], typeof me, Set<string>];
    if (signal.aborted) return;
    if (!thread) {
      status.textContent = t('Не найдено');
      return;
    }
    if (me) void forumView(id).catch(() => {});
  } catch (error) {
    if (!signal.aborted) status.textContent = forumErrorText(error);
    return;
  }

  const refresh = () => location.assign(`${threadHref(BASE, id)}?page=${page}`);
  document.title = `${thread.title} — ${t('Форум')} GenshinFlex`;
  const category = FORUM_CATEGORIES.find((item) => item.slug === thread.category);
  const crumb = el('a', category ? t(category.label) : t('Форум')) as HTMLAnchorElement;
  crumb.href = categoryHref(BASE, thread.category);
  heading.replaceChildren(
    crumb,
    el('h1', `${thread.pinned ? '📌 ' : ''}${thread.locked ? '🔒 ' : ''}${thread.title}`),
    el('span', thread.lang.toUpperCase(), 'muted'),
  );
  const subject = thread.subject_kind && thread.subject_id ? parseSubject(`${thread.subject_kind}:${thread.subject_id}`) : null;
  const subjectLink = subject ? subjectHref(BASE, subject) : null;
  if (subjectLink) {
    const link = el('a', t('Страница, к которой относится тема')) as HTMLAnchorElement;
    link.href = subjectLink;
    heading.append(link);
  }

  const form = root.querySelector<HTMLFormElement>('[data-reply-form]')!;
  const body = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const count = root.querySelector<HTMLElement>('[data-count]')!;
  const preview = root.querySelector<HTMLElement>('[data-preview]')!;
  body.addEventListener('input', () => {
    count.textContent = `${body.value.length}/10000`;
    if (!preview.hidden) preview.innerHTML = renderMarkup(body.value, BASE);
  }, { signal });
  root.querySelector<HTMLElement>('[data-tab-text]')!.addEventListener('click', () => {
    body.hidden = false;
    preview.hidden = true;
  }, { signal });
  root.querySelector<HTMLElement>('[data-tab-preview]')!.addEventListener('click', () => {
    body.hidden = true;
    preview.hidden = false;
    preview.innerHTML = renderMarkup(body.value, BASE);
  }, { signal });

  if (!me) {
    reply.replaceChildren(el('span', t('Войдите, чтобы ответить')));
    const link = el('a', t('Войти')) as HTMLAnchorElement;
    const { authUrl } = await import('../auth');
    if (signal.aborted) return;
    link.href = authUrl(BASE, 'login', location.pathname);
    reply.append(' ', link);
  } else if (me.banned) {
    reply.replaceChildren(el('p', forumErrorText({ message: 'forum:banned' }, me.banned_until)));
  } else if (thread.locked && !me.moderator) {
    reply.replaceChildren(el('p', t('Тема закрыта')));
  } else {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = body.value.trim();
      if (!text) return;
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      button.disabled = true;
      try {
        const postId = await createPost(id, text, replyTo);
        const updated = await forumThread(id);
        if (!signal.aborted) {
          const lastPage = Math.max(1, Math.ceil((updated?.post_count ?? thread.post_count + 1) / PAGE_SIZE));
          location.assign(`${threadHref(BASE, id)}?page=${lastPage}#p${postId}`);
        }
      } catch (error) {
        if (!signal.aborted) status.textContent = forumErrorText(error, me?.banned_until);
      } finally {
        button.disabled = false;
      }
    }, { signal });
  }

  const deleteDialog = root.querySelector<HTMLDialogElement>('[data-delete-dialog]')!;
  const reportDialog = root.querySelector<HTMLDialogElement>('[data-report-dialog]')!;
  let deleteTarget = 0;
  let reportTarget = 0;
  deleteDialog.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', () => deleteDialog.close(), { signal });
  reportDialog.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', () => reportDialog.close(), { signal });
  deleteDialog.querySelector<HTMLFormElement>('form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const reason = deleteDialog.querySelector<HTMLInputElement>('input')!.value.slice(0, 200);
      await deletePost(deleteTarget, reason);
      deleteDialog.close();
      refresh();
    } catch (error) {
      status.textContent = forumErrorText(error);
    }
  }, { signal });
  reportDialog.querySelector<HTMLFormElement>('form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const reason = reportDialog.querySelector<HTMLSelectElement>('select')!.value;
      const comment = reportDialog.querySelector<HTMLTextAreaElement>('textarea')!.value;
      await report(reportTarget, reason, comment);
      reportDialog.close();
      status.textContent = t('Жалоба отправлена');
    } catch (error) {
      status.textContent = forumErrorText(error);
    }
  }, { signal });

  postsBox.replaceChildren();
  for (const post of posts) {
    const card = el('article', '', 'panel forum-post');
    card.id = `p${post.id}`;
    if (post.deleted && !me?.moderator) {
      card.append(el('p', t('Сообщение удалено'), 'muted'));
      postsBox.append(card);
      continue;
    }

    const header = el('header');
    header.append(renderAuthor(post.author, BASE));
    const date = el('time', new Date(post.created_at).toLocaleString(pageLang()), 'small muted');
    header.append(date);
    if (post.edited_at) header.append(el('span', t('изменено'), 'small muted'));
    const anchor = el('a', `#${post.id}`, 'small') as HTMLAnchorElement;
    anchor.href = `#p${post.id}`;
    header.append(anchor);
    card.append(header);
    if (post.reply_to) {
      const parent = el('a', t('В ответ на #{id}', { id: post.reply_to }), 'small') as HTMLAnchorElement;
      parent.href = `#p${post.reply_to}`;
      card.append(parent);
    }
    const content = el('div', '', 'forum-body');
    if (post.deleted) content.textContent = t('Сообщение удалено');
    else content.innerHTML = renderMarkup(post.body || '', BASE);
    card.append(content);
    if (post.deleted && post.delete_reason) card.append(el('p', post.delete_reason, 'small muted'));
    if (!post.deleted) {
      const reactions = el('div', '', 'forum-actions');
      for (const reaction of REACTIONS) {
        const active = post.my_reactions?.includes(reaction.kind);
        const button = el(
          'button',
          `${reaction.emoji} ${post.reactions?.[reaction.kind] ?? 0}`,
          `btn small${active ? ' primary' : ''}`,
        ) as HTMLButtonElement;
        button.type = 'button';
        button.disabled = !me || !!me.banned;
        if (!me) button.title = t('Войдите, чтобы реагировать');
        button.addEventListener('click', async () => {
          try {
            await setReaction(post.id, reaction.kind, !active);
            refresh();
          } catch (error) {
            status.textContent = forumErrorText(error);
          }
        }, { signal });
        reactions.append(button);
      }
      card.append(reactions);
    }

    const actions = el('div', '', 'forum-actions');
    function action(label: string, handler: () => void) {
      const button = el('button', label, 'btn small') as HTMLButtonElement;
      button.type = 'button';
      button.addEventListener('click', handler, { signal });
      actions.append(button);
    }

    if (me && !me.banned && !post.deleted && (!thread.locked || me.moderator)) {
      action(t('Ответить'), () => {
        replyTo = post.id;
        body.value = `> ${(post.body || '').slice(0, 200).replace(/\n/g, '\n> ')}\n\n`;
        body.dispatchEvent(new Event('input'));
        body.focus();
        reply.scrollIntoView();
      });
    }
    if (post.mine && !post.deleted && !thread.locked) {
      action(t('Изменить'), () => {
        const editor = el('form');
        const text = document.createElement('textarea');
        text.className = 'input';
        text.maxLength = 10000;
        text.value = post.body || '';
        editor.append(text);
        let title: HTMLInputElement | null = null;
        if (post.id === thread.first_post_id) {
          title = document.createElement('input');
          title.className = 'input';
          title.value = thread.title;
          title.maxLength = 120;
          editor.prepend(title);
        }
        const save = el('button', t('Сохранить'), 'btn primary') as HTMLButtonElement;
        editor.append(save);
        editor.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            await editPost(post.id, text.value);
            if (title && title.value.trim() !== thread.title) await editThread(thread.id, title.value);
            refresh();
          } catch (error) {
            status.textContent = forumErrorText(error);
          }
        }, { signal });
        card.append(editor);
      });
    }
    if ((post.mine || me?.moderator) && !post.deleted) {
      action(t('Удалить'), () => {
        deleteTarget = post.id;
        if (me?.moderator) deleteDialog.showModal();
        else void deletePost(post.id).then(refresh).catch((error) => {
          status.textContent = forumErrorText(error);
        });
      });
    }
    if (me && !post.mine && !post.deleted && !me.banned) {
      action(t('Пожаловаться'), () => {
        reportTarget = post.id;
        reportDialog.showModal();
      });
    }
    if (me?.moderator && post.deleted) {
      action(t('Восстановить'), () => {
        void restorePost(post.id).then(refresh).catch((error) => {
          status.textContent = forumErrorText(error);
        });
      });
    }
    card.append(actions);
    if (!post.deleted && post.author?.id && blockedIds.has(post.author.id)) {
      const shown = [...card.children].filter((child) => !(child as HTMLElement).hidden) as HTMLElement[];
      for (const child of shown) child.hidden = true;
      const placeholder = el('p', t('Сообщение скрыто: вы заблокировали автора'), 'muted small');
      const show = el('button', t('Показать'), 'btn small') as HTMLButtonElement;
      show.type = 'button';
      show.addEventListener('click', () => {
        placeholder.remove();
        for (const child of shown) child.hidden = false;
      }, { signal });
      placeholder.append(' ', show);
      card.prepend(placeholder);
    }
    postsBox.append(card);
  }
  if (/^#p\d+$/.test(location.hash)) postsBox.querySelector<HTMLElement>(`#${location.hash.slice(1)}`)?.scrollIntoView({ block: 'start' });

  postsBox.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains('spoiler')) target.classList.toggle('revealed');
  }, { signal });
  postsBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.target as HTMLElement).classList.contains('spoiler')) {
      event.preventDefault();
      (event.target as HTMLElement).classList.toggle('revealed');
    }
  }, { signal });

  const pages = Math.max(1, Math.ceil(thread.post_count / PAGE_SIZE));
  pager.replaceChildren();
  for (let number = 1; number <= pages; number++) {
    const link = el('a', String(number), `btn small${number === page ? ' primary' : ''}`) as HTMLAnchorElement;
    link.href = `${threadHref(BASE, id)}?page=${number}`;
    pager.append(link);
  }

  if (me?.moderator) {
    moderator.hidden = false;
    function add(label: string, change: Parameters<typeof moderateThread>[1]) {
      const button = el('button', label, 'btn') as HTMLButtonElement;
      button.type = 'button';
      button.addEventListener('click', () => {
        void moderateThread(id, change).then(refresh).catch((error) => {
          status.textContent = forumErrorText(error);
        });
      }, { signal });
      moderator.append(button);
    }

    add(thread.pinned ? t('Открепить') : t('Закрепить'), { p_pinned: !thread.pinned });
    add(thread.locked ? t('Открыть тему') : t('Закрыть тему'), { p_locked: !thread.locked });
    add(thread.deleted ? t('Вернуть тему') : t('Скрыть тему'), { p_deleted: !thread.deleted });
    const select = document.createElement('select');
    select.className = 'input';
    for (const item of FORUM_CATEGORIES) {
      const option = document.createElement('option');
      option.value = item.slug;
      option.textContent = t(item.label);
      option.selected = item.slug === thread.category;
      select.append(option);
    }
    select.addEventListener('change', () => {
      void moderateThread(id, { p_category: select.value }).then(refresh).catch((error) => {
        status.textContent = forumErrorText(error);
      });
    }, { signal });
    moderator.append(select);
  }
  status.textContent = '';
}

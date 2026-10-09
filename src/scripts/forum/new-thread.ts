import { FORUM_CATEGORIES, threadHref } from '../../lib/forum';
import { pageLang } from '../../i18n/client';
import { BASE, t } from '../search';
import { createThread, forumErrorText, forumMe } from './api';
import { renderMarkup } from './markup';

export async function initNewThread(root: HTMLElement, signal: AbortSignal) {
  const form = root.querySelector<HTMLFormElement>('form')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const category = form.querySelector<HTMLSelectElement>('[name="category"]')!;
  const body = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const preview = root.querySelector<HTMLElement>('[data-preview]')!;
  const count = root.querySelector<HTMLElement>('[data-count]')!;
  try {
    const me = await forumMe();
    if (signal.aborted) return;
    if (!me) {
      form.hidden = true;
      const { authUrl } = await import('../auth');
      if (signal.aborted) return;
      const link = document.createElement('a');
      link.href = authUrl(BASE, 'login', location.pathname);
      link.textContent = t('Войдите, чтобы писать на форуме');
      status.replaceChildren(link);
      return;
    }
    if (me.banned) {
      form.hidden = true;
      status.textContent = forumErrorText({ message: 'forum:banned' }, me.banned_until);
      return;
    }
    for (const item of FORUM_CATEGORIES) {
      if (item.slug === 'announcements' && !me.moderator) continue;
      const option = document.createElement('option');
      option.value = item.slug;
      option.textContent = t(item.label);
      category.append(option);
    }
    const chosen = new URLSearchParams(location.search).get('c');
    if ([...category.options].some((option) => option.value === chosen)) category.value = chosen!;
    form.querySelector<HTMLSelectElement>('[name="lang"]')!.value = pageLang();
  } catch (error) {
    status.textContent = forumErrorText(error);
    return;
  }

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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = form.querySelector<HTMLInputElement>('[name="title"]')!;
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    if (title.value.trim().length < 3 || title.value.trim().length > 120 || !body.value.trim()) {
      status.textContent = t('Проверьте заполнение');
      return;
    }
    button.disabled = true;
    try {
      const lang = form.querySelector<HTMLSelectElement>('[name="lang"]')!.value;
      const id = await createThread(category.value, title.value, body.value, lang);
      if (!signal.aborted) location.assign(threadHref(BASE, id));
    } catch (error) {
      if (!signal.aborted) status.textContent = forumErrorText(error);
    } finally {
      button.disabled = false;
    }
  }, { signal });
}

import { pageLang } from '../i18n/client';
import { SUPABASE_URL } from '../lib/platform';
import { BASE, t } from './search';
import { hasSession } from './user-data/session';
import { colorOk, createEffect, readPickerChars, renderAppearance, usesMedia, validCustom, type Custom } from './profile-view';
import type { MediaKey } from './profile-media';

type PublicRow = { id: string; nickname: string; display_name: string | null; created_at: string; active_title: string | null; custom: unknown };
type Title = { id: string; name_ru: string; name_en: string | null; name_es: string | null; color: string; description: string | null };

export async function initPublicProfile(root: HTMLElement, signal: AbortSignal) {
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const status = $('public-profile-status');
  const path = location.pathname.match(/^(?:\/(?:en|es))?\/u\/([^/]+)\/?$/);
  let nick = '';
  try { nick = path ? decodeURIComponent(path[1]) : new URLSearchParams(location.search).get('n') || ''; }
  catch { /* Некорректный URL равнозначен отсутствующему нику */ }
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(nick)) { status.textContent = t('Профиль не найден или скрыт'); return; }

  const pickerBySlug = new Map(readPickerChars(document.getElementById('profile-chars')).map((char) => [char.slug, char]));
  const avatar = $('profile-avatar');
  const placeholder = avatar.firstElementChild!.cloneNode(true);
  let custom: Custom = validCustom(null, pickerBySlug).value;
  const effect = createEffect($<HTMLCanvasElement>('profile-effect'), () => custom, signal);
  signal.addEventListener('abort', () => document.documentElement.classList.remove('profile-custom-bg'), { once: true });
  try {
    const { getSupabase } = await import('./auth');
    if (signal.aborted) return;
    const client = getSupabase();
    const { data, error } = await client.from('public_profiles').select('id,nickname,display_name,created_at,active_title,custom').eq('nickname', nick).maybeSingle();
    if (signal.aborted) return;
    if (error) throw error;
    const row = data as PublicRow | null;
    if (!row) { status.textContent = t('Профиль не найден или скрыт'); return; }
    if (path && row.nickname !== nick) {
      const url = new URL(location.href);
      url.pathname = `${pageLang() === 'ru' ? '' : `/${pageLang()}`}/u/${encodeURIComponent(row.nickname)}/`;
      history.replaceState(history.state, '', url);
    }
    for (const link of document.querySelectorAll<HTMLAnchorElement>('#language-menu a[hreflang]')) {
      const lang = link.hreflang;
      if (lang === 'ru' || lang === 'en' || lang === 'es') link.href = `${lang === 'ru' ? '' : `/${lang}`}/u/${encodeURIComponent(row.nickname)}/`;
    }
    custom = validCustom(row.custom, pickerBySlug).value;
    const mediaSource = (key: MediaKey) => usesMedia(custom, key) && custom.media[key] && row.id
      ? `${SUPABASE_URL}/storage/v1/object/public/profile-media/${encodeURIComponent(row.id)}/${key}-${custom.media[key]}` : null;
    const name = custom.nick || row.display_name || row.nickname;
    renderAppearance(root, custom, pickerBySlug, mediaSource, name, placeholder, effect);
    const handle = $('profile-handle');
    handle.textContent = `@${row.nickname}`;
    handle.hidden = false;
    const date = new Date(row.created_at);
    const meta = $('profile-meta');
    if (!Number.isNaN(date.getTime())) {
      meta.textContent = t('На сайте с {date}', { date: date.toLocaleDateString(pageLang(), { month: 'long', year: 'numeric' }) });
      meta.hidden = false;
    }
    document.title = `${name} — GenshinFlex`;
    status.textContent = '';

    if (row.active_title) {
      const result = await client.from('titles').select('id,name_ru,name_en,name_es,color,description').eq('id', row.active_title).maybeSingle();
      if (signal.aborted) return;
      const title = result.data as Title | null;
      if (!result.error && title) {
        const chip = $('profile-title');
        const lang = pageLang();
        chip.style.setProperty('--title-color', colorOk(title.color) ? title.color : '#e3b04b');
        chip.replaceChildren(Object.assign(document.createElement('span'), { className: 'title-mark', textContent: '◆' }),
          document.createTextNode((lang === 'en' ? title.name_en : lang === 'es' ? title.name_es : null) || title.name_ru));
        chip.title = title.description || '';
        chip.hidden = false;
      }
    }
    if (hasSession()) {
      const { data: session } = await client.auth.getSession();
      if (signal.aborted) return;
      if (session.session?.user.id === row.id) $('public-own-link').hidden = false;
    }
  } catch {
    if (!signal.aborted) status.textContent = t('Не удалось загрузить профиль');
  }
}

import { pageLang } from '../i18n/client';
import { SUPABASE_URL } from '../lib/platform';
import { BASE, t } from './search';
import { hasSession } from './user-data/session';
import { colorOk, createEffect, fetchShowcase, loadChars, readPickerChars, renderAppearance, renderEntryList,
  renderRosterList, renderShowcase, renderWishSummary, usesMedia, validCustom, validRoster, type Custom, type WishSummary } from './profile-view';
import type { MediaKey } from './profile-media';
import type { Entry } from './common';

type PublicRow = { id: string; nickname: string; display_name: string | null; created_at: string; active_title: string | null; custom: unknown };
type Title = { id: string; name_ru: string; name_en: string | null; name_es: string | null; color: string; description: string | null };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

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
    const charsRequest = loadChars(signal).catch(() => null);
    void (async () => {
      try {
        const { data: extras, error } = await client.rpc('public_profile_extras', { p_nickname: row.nickname });
        if (signal.aborted || error || !isRecord(extras)) return;
        if (typeof extras.uid === 'string' && /^\d{9,10}$/.test(extras.uid)) {
          const uid = extras.uid;
          $('public-showcase').hidden = false;
          $('public-showcase-uid').textContent = t('UID {uid}', { uid });
          const copy = $<HTMLButtonElement>('public-uid-copy');
          copy.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(uid);
              if (!signal.aborted) copy.textContent = t('Скопировано');
            } catch {
              if (!signal.aborted) copy.textContent = t('Не удалось скопировать');
            }
          }, { signal });
          void (async () => {
            try {
              const profile = await fetchShowcase(uid, signal);
              if (signal.aborted) return;
              const chars = await charsRequest;
              if (signal.aborted) return;
              renderShowcase($('public-showcase-list'), $('public-showcase-meta'), profile, chars?.byId ?? new Map());
            } catch {
              if (!signal.aborted) $('public-showcase-status').textContent = t('Витрина недоступна');
            }
          })();
        }
        if (isRecord(extras.favorites)) {
          const favorites = extras.favorites;
          const preferred = favorites[pageLang()];
          const list = Array.isArray(preferred) && preferred.length ? preferred : favorites.ru;
          if (Array.isArray(list)) renderEntryList($('public-favorites-list'), list as Entry[], '', true);
        }
        if (Array.isArray(extras.roster)) {
          const roster = extras.roster;
          void charsRequest.then((chars) => {
            if (signal.aborted || !chars) return;
            const { bySlug } = chars;
            const list = validRoster(roster, bySlug)?.value ?? [];
            if (list.length) {
              $('public-roster').hidden = false;
              renderRosterList($('public-roster-list'), $('public-roster-count'), list, bySlug);
            }
          });
        }
        if (Array.isArray(extras.wishes)) {
          const accounts: WishSummary[] = extras.wishes.filter(isRecord).map((account, index) => {
            const pity = isRecord(account.pity) ? account.pity : {};
            const recent = Array.isArray(account.recent) ? account.recent.filter(isRecord).filter((wish) =>
              typeof wish.name === 'string' && typeof wish.gacha_type === 'string' && typeof wish.time === 'string')
              .map((wish) => ({ name: wish.name as string, gacha_type: wish.gacha_type as string, time: wish.time as string })) : [];
            const label = account.uid === 'manual' ? t('Ручной ввод') : typeof account.uid === 'string'
              ? t('UID {uid}', { uid: account.uid }) : t('Аккаунт {n}', { n: index + 1 });
            return { label, total: count(account.total), fives: count(account.fives),
              pity: { character: count(pity.character), weapon: count(pity.weapon), standard: count(pity.standard) }, recent };
          });
          $('public-wishes').hidden = false;
          renderWishSummary($('public-wishes-list'), accounts);
        }
      } catch { /* Дополнительные данные не влияют на основной профиль */ }
    })();

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

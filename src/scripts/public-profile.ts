import { pageLang } from '../i18n/client';
import { threadHref } from '../lib/forum';
import { SUPABASE_URL } from '../lib/platform';
import { BASE, t } from './search';
import { forumUserPosts } from './forum/api';
import { plainSnippet } from './forum/markup';
import { block, friendRemove, friendRequest, friendRespond, follow, socialCounts, socialErrorText, socialRelation, unblock, unfollow, type SocialListKind, type SocialRelation } from './social/api';
import { initConnections } from './social/lists';
import { hasSession, onSessionChange } from './user-data/session';
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
    const { authUrl, getSupabase } = await import('./auth');
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
    const profileId = row.id;
    const connections = initConnections(root, profileId, signal);
    void (async () => {
      const card = $('public-social');
      const actions = $('public-social-actions');
      const socialStatus = $('public-social-status');
      const ownLink = $('public-own-link');
      let generation = 0;
      const initialize = async () => {
        const turn = ++generation;
        const current = () => !signal.aborted && turn === generation;
        let countsRequest = 0;
        const refreshCounts = async () => {
          const request = ++countsRequest;
          const counts = await socialCounts(profileId);
          if (!current() || request !== countsRequest) return;
          connections.setCounts(counts);
          card.hidden = false;
        };
        connections.setCounts(null);
        actions.replaceChildren();
        socialStatus.textContent = '';
        ownLink.hidden = true;
        void refreshCounts().catch(() => { if (current()) connections.countsUnavailable(); });
        try {
          const userId = hasSession() ? (await client.auth.getSession()).data.session?.user.id : null;
          if (!current()) return;
          ownLink.hidden = userId !== profileId;
          if (userId === profileId) {
            const link = document.createElement('a');
            link.className = 'btn';
            link.href = `${BASE}/friends/`;
            link.textContent = t('Заявки в друзья');
            actions.replaceChildren(link);
            card.hidden = false;
            return;
          }
          if (!userId) {
            const link = document.createElement('a');
            link.className = 'btn';
            link.href = authUrl(BASE, 'login', location.pathname);
            link.textContent = t('Войдите, чтобы подписаться или добавить в друзья');
            actions.replaceChildren(link);
            card.hidden = false;
            return;
          }
          let busy = false;
          const addButton = (label: string, action: () => Promise<unknown>, primary = false, kind?: SocialListKind) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = primary ? 'btn primary' : 'btn';
            button.textContent = label;
            button.addEventListener('click', () => { void run(action, kind); }, { signal });
            actions.append(button);
          };
          const addText = (label: string) => {
            const text = document.createElement('span');
            text.className = 'small muted';
            text.textContent = label;
            actions.append(text);
          };
          function render(relation: SocialRelation) {
            actions.replaceChildren();
            if (relation.blocked) {
              addText(t('Вы заблокировали этого пользователя'));
              addButton(t('Разблокировать'), () => unblock(profileId));
              return;
            }
            if (relation.following) addButton(t('Отписаться'), () => unfollow(profileId), false, 'followers');
            else addButton(t('Подписаться'), () => follow(profileId), true, 'followers');
            if (relation.followed_by) addText(t('Подписан на вас'));
            if (relation.friend === 'none') {
              if (relation.can_request === false) addText(t('Не принимает заявки в друзья'));
              else addButton(t('В друзья'), () => friendRequest(profileId), false, 'friends');
            } else if (relation.friend === 'outgoing') {
              addText(t('Заявка отправлена'));
              addButton(t('Отменить заявку'), () => friendRemove(profileId), false, 'friends');
            } else if (relation.friend === 'incoming') {
              addText(t('Хочет добавить вас в друзья'));
              addButton(t('Принять'), () => friendRespond(profileId, true), true, 'friends');
              addButton(t('Отклонить'), () => friendRespond(profileId, false), false, 'friends');
            } else if (relation.friend === 'friends') {
              addText(t('В друзьях'));
              addButton(t('Убрать из друзей'), () => friendRemove(profileId), false, 'friends');
            } else if (relation.friend === 'declined') addText(t('Заявка отклонена'));
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn';
            button.textContent = t('Заблокировать');
            button.addEventListener('click', () => {
              if (busy) return;
              const message = document.createElement('span');
              message.className = 'small muted';
              message.textContent = t('Заблокировать? Подписки и дружба будут удалены.');
              const confirm = document.createElement('button');
              confirm.type = 'button';
              confirm.className = 'btn';
              confirm.textContent = t('Да, заблокировать');
              confirm.addEventListener('click', () => { void run(() => block(profileId)); }, { signal });
              const cancel = document.createElement('button');
              cancel.type = 'button';
              cancel.className = 'btn';
              cancel.textContent = t('Отмена');
              cancel.addEventListener('click', () => render(relation), { signal });
              button.replaceWith(message, confirm, cancel);
            }, { signal });
            actions.append(button);
          }
          async function run(action: () => Promise<unknown>, kind?: SocialListKind) {
            if (!current() || busy) return;
            busy = true;
            socialStatus.textContent = '';
            for (const button of actions.querySelectorAll('button')) button.disabled = true;
            try {
              await action();
              if (!current()) return;
              void refreshCounts().catch(() => {});
              connections.reload(kind);
              try {
                const relation = await socialRelation(profileId);
                if (!current()) return;
                render(relation);
              } catch {
                if (!current()) return;
                actions.replaceChildren();
                socialStatus.textContent = t('Не удалось загрузить');
              }
            } catch (error) {
              if (current()) socialStatus.textContent = socialErrorText(error);
            } finally {
              if (current()) {
                busy = false;
                for (const button of actions.querySelectorAll('button')) button.disabled = false;
              }
            }
          }
          const relation = await socialRelation(profileId);
          if (!current()) return;
          render(relation);
          card.hidden = false;
        } catch {
          if (!current()) return;
          actions.replaceChildren();
          socialStatus.textContent = t('Не удалось загрузить');
          card.hidden = false;
        }
      };
      onSessionChange(() => { void initialize(); }, { signal });
      void initialize();
    })();

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

    void (async () => {
      const card = $('public-forum');
      const list = $('public-forum-list');
      const more = $<HTMLButtonElement>('public-forum-more');
      const forumStatus = $('public-forum-status');
      let shown = 0;
      const load = async () => {
        more.disabled = true;
        try {
          const posts = await forumUserPosts(row.nickname, 6, shown);
          if (signal.aborted) return;
          for (const post of posts.slice(0, 5)) {
            const item = document.createElement('div');
            item.className = 'public-forum-post';
            const link = document.createElement('a');
            link.href = `${threadHref(BASE, post.thread_id)}#p${post.id}`;
            link.textContent = post.thread_title;
            const snippet = document.createElement('p');
            snippet.textContent = plainSnippet(post.body, 160);
            const date = document.createElement('time');
            date.dateTime = post.created_at;
            date.textContent = new Date(post.created_at).toLocaleDateString(pageLang(), { day: 'numeric', month: 'short', year: 'numeric' });
            item.append(link, snippet, date);
            list.append(item);
          }
          shown += Math.min(posts.length, 5);
          card.hidden = shown === 0;
          more.hidden = posts.length <= 5;
          forumStatus.textContent = '';
        } catch {
          if (!signal.aborted && shown) forumStatus.textContent = t('Не удалось загрузить');
        } finally {
          if (!signal.aborted) more.disabled = false;
        }
      };
      more.addEventListener('click', () => { void load(); }, { signal });
      await load();
      if (signal.aborted) return;
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
  } catch {
    if (!signal.aborted) status.textContent = t('Не удалось загрузить профиль');
  }
}

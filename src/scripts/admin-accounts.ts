// Вкладка «Аккаунты» в админке: список всех аккаунтов, карточка, баны на сайте и форуме, удаление.
// Данные — из API (/admin/accounts*), доступ — роль admin в Supabase.
import { API_URL } from '../lib/platform';
import { authUrl, getSupabase, pageBase } from './auth';
import { cleanup } from './router';

type Account = {
  id: string; email: string | null; created_at: string; last_sign_in_at: string | null; providers: string[];
  banned_until: string | null; ban_reason: string | null;
  nickname: string | null; display_name: string | null; is_public: boolean | null;
  roles: string[]; titles: string[];
  forum_banned: boolean; forum_ban_until: string | null; forum_ban_reason: string | null;
  threads: number; posts: number; telegram: string | null;
};
type Page = { items: Account[]; total: number; page: number; pageSize: number };
type Scope = 'site' | 'forum';

// Бан «навсегда» в Supabase — это срок ~100 лет
const FOREVER_MS = 50 * 365 * 86_400_000;
const PERIODS: [string, string][] = [['1', '1 день'], ['7', '7 дней'], ['30', '30 дней'], ['', 'Навсегда']];

export function initAccounts(section: HTMLElement, signal: AbortSignal) {
  const controller = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  cleanup(signal, () => {
    controller.abort();
    for (const timer of timers) clearTimeout(timer);
  });

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, value = '', className = '') => {
    const el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    return el;
  };
  const button = (label: string, className = 'btn small') => {
    const el = make('button', label, className);
    el.type = 'button';
    return el;
  };
  const q = <T extends HTMLElement>(s: string) => section.querySelector<T>(s)!;
  const date = (s: string | null) => s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const siteBanned = (a: Account) => !!a.banned_until && Date.parse(a.banned_until) > Date.now();
  const until = (s: string | null) => !s || Date.parse(s) - Date.now() > FOREVER_MS ? 'навсегда' : `до ${date(s)}`;
  const name = (a: Account) => a.nickname || 'без профиля';

  const access = q('#accounts-auth');
  const content = q('#accounts-content');
  const listView = q('#accounts-list-view');
  const list = q('#accounts-list');
  const detail = q('#accounts-detail');
  const search = q<HTMLInputElement>('#accounts-query');
  const filter = q<HTMLSelectElement>('#accounts-filter');
  const prev = q<HTMLButtonElement>('#accounts-prev');
  const next = q<HTMLButtonElement>('#accounts-next');
  const listError = q('#accounts-error');

  let page = 0;
  let total = 0;
  let items: Account[] = [];
  let open: Account | null = null;
  let me: string | null = null;
  let loadId = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const { data } = await getSupabase().auth.getSession();
    if (signal.aborted) throw new DOMException('Запрос отменён', 'AbortError');
    const token = data.session?.access_token;
    if (!token) throw Object.assign(new Error('Требуется вход'), { status: 401 });
    const res = await fetch(`${API_URL}${path}`, {
      method, signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const out = await res.json().catch(() => ({})) as T & { error?: string };
    if (!res.ok) throw Object.assign(new Error(out.error || `Ошибка ${res.status}`), { status: res.status });
    return out;
  }

  function showAccess(kind: 'login' | 'forbidden' | null) {
    access.hidden = !kind;
    content.hidden = !!kind;
    access.replaceChildren();
    if (kind === 'login') {
      access.append('Войдите в аккаунт на сайте, чтобы управлять аккаунтами. ');
      const link = make('a', 'Войти');
      link.href = authUrl(pageBase(), 'login', '/admin/');
      access.append(link);
    }
    if (kind === 'forbidden') access.textContent = 'У вашего аккаунта нет роли admin';
  }
  // fromLoad: 403 при загрузке — нет роли admin; 403 у действия — защищённый аккаунт
  function fail(error: unknown, notice: HTMLElement, fromLoad = false): void {
    if (signal.aborted || (error as Error).name === 'AbortError') return;
    const value = error as Error & { status?: number };
    if (value.status === 401) return showAccess('login');
    if (value.status === 403 && fromLoad) return showAccess('forbidden');
    notice.textContent = value.message || 'Не удалось выполнить запрос';
    notice.hidden = false;
  }

  function badges(a: Account) {
    const row = make('div', '', 'row acc-badges');
    for (const role of a.roles) row.append(make('span', role, `chip${role === 'admin' ? ' gold' : ''}`));
    if (siteBanned(a)) row.append(make('span', `Бан на сайте ${until(a.banned_until)}`, 'chip acc-ban'));
    if (a.forum_banned) row.append(make('span', `Бан на форуме ${until(a.forum_ban_until)}`, 'chip acc-ban'));
    return row;
  }

  function renderList() {
    q('#accounts-count').textContent = `Найдено: ${total}`;
    prev.disabled = page === 0;
    next.disabled = (page + 1) * 50 >= total;
    q('#accounts-page').textContent = total > 50 ? `Стр. ${page + 1} из ${Math.ceil(total / 50)}` : '';
    if (!items.length) return list.replaceChildren(make('p', 'Аккаунты не найдены.', 'muted'));
    list.replaceChildren(...items.map((a) => {
      const row = make('button', '', 'panel acc-row');
      row.type = 'button';
      row.dataset.accountId = a.id;
      const head = make('span', '', 'acc-head');
      head.append(make('b', name(a)));
      if (a.display_name) head.append(make('span', a.display_name, 'muted small'));
      row.append(head, make('span', a.email || '—', 'small acc-email'),
        make('span', `${a.providers.join(', ') || '—'} · рег. ${date(a.created_at)} · вход ${date(a.last_sign_in_at)}`, 'muted small'));
      const b = badges(a);
      if (b.childElementCount) row.append(b);
      return row;
    }));
  }

  async function load(refreshDetail = true): Promise<void> {
    const current = ++loadId;
    listError.hidden = true;
    try {
      const params = new URLSearchParams({ page: String(page), filter: filter.value });
      if (search.value.trim()) params.set('q', search.value.trim());
      const [result, id] = await Promise.all([api<Page>(`/admin/accounts?${params}`), getSupabase().auth.getSession().then(({ data }) => data.session?.user.id ?? null)]);
      if (signal.aborted || current !== loadId) return;
      // Страница опустела (например, удалили последний аккаунт на ней) — уходим на предыдущую
      if (!result.items.length && page > 0) {
        page--;
        return load(refreshDetail);
      }
      me = id;
      showAccess(null);
      items = result.items;
      total = result.total;
      renderList();
      if (open && refreshDetail) {
        const target = open.id;
        const fresh = await api<Account>(`/admin/accounts/${target}`);
        if (!signal.aborted && current === loadId && open?.id === target) renderDetail(fresh);
      }
    } catch (error) {
      if (current === loadId) fail(error, listError, true);
    }
  }

  function field(label: string, value: string | Node) {
    const row = make('div', '', 'acc-field');
    row.append(make('span', label, 'muted small'));
    const out = make('span');
    out.append(value);
    row.append(out);
    return row;
  }

  function banBlock(a: Account, scope: Scope, notice: HTMLElement) {
    const box = make('div', '', 'panel acc-action');
    box.append(make('h3', scope === 'site' ? 'Бан на сайте' : 'Бан на форуме'));
    const active = scope === 'site' ? siteBanned(a) : a.forum_banned;
    if (active) {
      const reason = scope === 'site' ? a.ban_reason : a.forum_ban_reason;
      box.append(make('p', `Действует ${until(scope === 'site' ? a.banned_until : a.forum_ban_until)}${reason ? ` · ${reason}` : ''}`, 'small'));
      const lift = button('Снять бан', 'btn small primary');
      lift.addEventListener('click', () => void act(lift, notice, () =>
        api<Account>(`/admin/accounts/${a.id}/ban/${scope}`, 'DELETE')), { signal });
      box.append(lift);
      return box;
    }
    box.append(make('p', scope === 'site'
      ? 'Не сможет войти на сайт; уже открытая сессия перестанет работать в течение часа.'
      : 'Не сможет создавать темы, писать и ставить реакции на форуме.', 'muted small'));
    const row = make('div', '', 'row acc-ban-form');
    const period = make('select');
    period.setAttribute('aria-label', 'Срок бана');
    for (const [value, label] of PERIODS) {
      const option = make('option', label);
      option.value = value;
      period.append(option);
    }
    period.value = '7';
    const reason = make('input');
    reason.placeholder = 'Причина (необязательно)';
    reason.maxLength = 200;
    reason.setAttribute('aria-label', 'Причина бана');
    const ban = button('Забанить', 'btn small acc-danger');
    ban.addEventListener('click', () => void act(ban, notice, () => api<Account>(`/admin/accounts/${a.id}/ban`, 'POST', {
      scope, days: period.value ? Number(period.value) : null, reason: reason.value.trim(),
    })), { signal });
    row.append(period, reason, ban);
    box.append(row);
    return box;
  }

  function deleteBlock(a: Account, notice: HTMLElement) {
    const box = make('div', '', 'panel acc-action');
    box.append(make('h3', 'Удалить аккаунт'));
    const expected = a.nickname || a.id;
    box.append(make('p', 'Аккаунт, профиль, медиа, крутки и сообщения на форуме будут удалены безвозвратно.', 'muted small'));
    const start = button('Удалить аккаунт…', 'btn small acc-danger');
    const confirmRow = make('div', '', 'row acc-ban-form');
    confirmRow.hidden = true;
    const input = make('input', '', 'acc-confirm');
    input.placeholder = a.nickname ? 'Введите ник для подтверждения' : 'Введите ID для подтверждения';
    input.setAttribute('aria-label', input.placeholder);
    input.autocomplete = 'off';
    const confirm = button('Удалить навсегда', 'btn small acc-danger');
    confirm.disabled = true;
    input.addEventListener('input', () => { confirm.disabled = input.value !== expected; }, { signal });
    start.addEventListener('click', () => { start.hidden = true; confirmRow.hidden = false; input.focus(); }, { signal });
    confirm.addEventListener('click', async () => {
      notice.hidden = true;
      lock(true);
      try {
        await api(`/admin/accounts/${a.id}`, 'DELETE', { confirm: input.value });
        if (signal.aborted) return;
        if (open?.id === a.id) closeDetail();
        await load(false);
      } catch (error) {
        fail(error, notice);
        if (!signal.aborted && confirm.isConnected) unlock();
      }
    }, { signal });
    confirmRow.append(input, confirm);
    box.append(start, confirmRow);
    return box;
  }

  // Пока идёт запрос, все действия в карточке заблокированы — ответы не обгоняют друг друга
  const lock = (on: boolean) => detail.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('.acc-actions button, .acc-actions input, .acc-actions select')
    .forEach((el) => { el.disabled = on; });
  const unlock = () => {
    lock(false);
    // Кнопка удаления остаётся активной только при верно введённом нике
    detail.querySelectorAll('.acc-confirm').forEach((el) => el.dispatchEvent(new Event('input')));
  };

  async function act(control: HTMLButtonElement, notice: HTMLElement, run: () => Promise<Account>) {
    notice.hidden = true;
    lock(true);
    try {
      const fresh = await run();
      if (signal.aborted) return;
      // Пока шёл запрос, могли открыть другой аккаунт — тогда его карточку не трогаем
      if (open?.id === fresh.id) renderDetail(fresh);
      // Бан мог вывести аккаунт из фильтра — перечитываем выборку и счётчик
      void load(false);
    } catch (error) {
      fail(error, notice);
      if (!signal.aborted && control.isConnected) unlock();
    }
  }

  function renderDetail(a: Account) {
    open = a;
    listView.hidden = true;
    detail.hidden = false;
    const back = button('← К списку');
    back.addEventListener('click', closeDetail, { signal });
    const card = make('article', '', 'panel acc-card');
    const head = make('header', '', 'acc-head');
    head.append(make('h2', name(a)));
    if (a.display_name) head.append(make('span', a.display_name, 'muted'));
    card.append(head, badges(a));

    const id = make('span', '', 'row acc-id');
    const copy = button('Копировать');
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(a.id).catch(() => {});
      if (signal.aborted) return;
      copy.textContent = 'Скопировано';
      const timer = setTimeout(() => { timers.delete(timer); copy.textContent = 'Копировать'; }, 2000);
      timers.add(timer);
    }, { signal });
    id.append(make('code', a.id, 'small'), copy);
    const fields = make('div', '', 'acc-fields');
    fields.append(
      field('ID', id),
      field('Почта', a.email || '—'),
      field('Способы входа', a.providers.join(', ') || '—'),
      field('Telegram', a.telegram ? `@${a.telegram}` : '—'),
      field('Регистрация', date(a.created_at)),
      field('Последний вход', date(a.last_sign_in_at)),
      field('Титулы', a.titles.join(', ') || '—'),
      field('Форум', `тем: ${a.threads} · сообщений: ${a.posts}`),
    );
    if (a.nickname && a.is_public) {
      const link = make('a', `/u/${a.nickname}`);
      link.href = `/u/${encodeURIComponent(a.nickname)}`;
      link.target = '_blank';
      link.rel = 'noopener';
      fields.append(field('Публичный профиль', link));
    } else {
      fields.append(field('Публичный профиль', a.nickname ? 'скрыт' : '—'));
    }
    card.append(fields);

    const notice = make('p', '', 'notice');
    notice.hidden = true;
    const actions = make('div', '', 'acc-actions');
    if (a.id === me) actions.append(make('p', 'Это ваш аккаунт — баны и удаление недоступны.', 'muted small'));
    else if (a.roles.includes('admin')) actions.append(make('p', 'Администратора нельзя забанить или удалить.', 'muted small'));
    else actions.append(banBlock(a, 'site', notice), banBlock(a, 'forum', notice), deleteBlock(a, notice));
    detail.replaceChildren(back, card, notice, actions);
  }

  function closeDetail() {
    open = null;
    detail.hidden = true;
    detail.replaceChildren();
    listView.hidden = false;
  }

  list.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-account-id]');
    const account = row && items.find((a) => a.id === row.dataset.accountId);
    if (account) renderDetail(account);
  }, { signal });
  search.addEventListener('input', () => {
    ++loadId;
    if (searchTimer) { clearTimeout(searchTimer); timers.delete(searchTimer); }
    searchTimer = setTimeout(() => { timers.delete(searchTimer!); page = 0; void load(); }, 300);
    timers.add(searchTimer);
  }, { signal });
  filter.addEventListener('change', () => { page = 0; void load(); }, { signal });
  prev.addEventListener('click', () => { if (page > 0) { page--; void load(); } }, { signal });
  next.addEventListener('click', () => { page++; void load(); }, { signal });

  return { load };
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, TURNSTILE_SITE_KEY } from '../lib/platform';
import { SESSION_KEY } from './user-data/session';

// Схема базы не сгенерирована — клиент без типов таблиц (иначе supabase-js выводит never)
let client: SupabaseClient<any> | undefined;

export function getSupabase() {
  return client ??= createClient<any>(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      flowType: 'implicit',
      persistSession: true,
      detectSessionInUrl: false,
      autoRefreshToken: true,
      storageKey: SESSION_KEY,
    },
  });
}

const AUTH_PENDING = 'gf:auth.pending';
type AuthExpect = { kind: 'email'; email: string } | { kind: 'user'; id: string } | { kind: 'oauth' };
type TokenPayload = { email?: unknown; sub?: unknown; exp?: unknown };

// Метка «этот браузер сам начал вход»: ссылка с токенами этой попытки принимается без вопроса
export function markAuthPending(expect: AuthExpect) {
  try {
    localStorage.setItem(AUTH_PENDING, JSON.stringify({
      at: Date.now(),
      ...expect,
      ...(expect.kind === 'email' ? { email: expect.email.trim().toLowerCase() } : {}),
    }));
  } catch {}
}

// Содержимое токена читаем только для проверки срока: подпись проверяет getUser до сверки метки
function tokenPayload(token: string): TokenPayload {
  try {
    const part = token.split('.')[1] || '';
    const bytes = Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return payload && typeof payload === 'object' ? payload as TokenPayload : {};
  } catch { return {}; }
}

// Метка подходит, только если токен относится к попытке входа, начатой в этом браузере:
// письмо — на ту же почту, привязка — к тому же аккаунту, OAuth — в течение 10 минут
function pendingMatches(payload: TokenPayload): boolean {
  try {
    const raw = localStorage.getItem(AUTH_PENDING);
    if (raw === null) return false;
    let mark: { at?: unknown; kind?: unknown; email?: unknown; id?: unknown } | null = null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') mark = parsed;
    } catch {}
    const age = Date.now() - Number(mark?.at);
    const limit = mark?.kind === 'email' ? 60 * 60 * 1000 : 10 * 60 * 1000;
    const fresh = !!mark && age >= 0 && age <= limit;
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const matches = fresh && (
      mark!.kind === 'oauth'
      || (mark!.kind === 'email' && !!email && mark!.email === email)
      || (mark!.kind === 'user' && typeof payload.sub === 'string' && mark!.id === payload.sub)
    );
    // Использованную или просроченную метку убираем, свежую несовпавшую оставляем.
    // Значение сверяем, чтобы не стереть метку более новой попытки из другой вкладки
    if ((matches || !fresh) && localStorage.getItem(AUTH_PENDING) === raw) localStorage.removeItem(AUTH_PENDING);
    return matches;
  } catch { return false; }
}

export async function consumeUrlSession(options?: { confirm?: (email: string) => Promise<boolean> }): Promise<'none' | 'ok' | 'error' | 'declined'> {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!hash.has('access_token') && !hash.has('refresh_token')) return 'none';
  const accessToken = hash.get('access_token') || '';
  const refreshToken = hash.get('refresh_token') || '';
  history.replaceState(null, '', location.pathname + location.search);
  if (!accessToken || !refreshToken) return 'error';
  const payload = tokenPayload(accessToken);
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp * 1000 - Date.now() < 30_000) return 'error';
  try {
    const { data: verified, error: verifyError } = await getSupabase().auth.getUser(accessToken);
    if (verifyError || !verified.user) return 'error';
    const user = verified.user;
    if (!pendingMatches({ email: user.email, sub: user.id })) {
      const email = user.email || user.id;
      try { if (!await options?.confirm?.(email)) return 'declined'; } catch { return 'declined'; }
    }
    const { data, error } = await getSupabase().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) return 'error';
    if (data.session?.user.id !== user.id) {
      try { await getSupabase().auth.signOut({ scope: 'local' }); } catch {}
      return 'error';
    }
    return 'ok';
  } catch { return 'error'; }
}

export function confirmUrlSession(root: HTMLElement, email: string): Promise<boolean> {
  const panel = root.querySelector<HTMLElement>('[data-auth-confirm]')!;
  panel.querySelector<HTMLElement>('[data-auth-confirm-message]')!.textContent = (root.dataset.confirm || '').replace('{email}', email);
  panel.hidden = false;
  return new Promise((resolve) => {
    const controller = new AbortController();
    const finish = (value: boolean) => { controller.abort(); panel.hidden = true; resolve(value); };
    panel.querySelector('[data-auth-continue]')!.addEventListener('click', () => finish(true), { signal: controller.signal });
    panel.querySelector('[data-auth-cancel]')!.addEventListener('click', () => finish(false), { signal: controller.signal });
    document.addEventListener('astro:before-swap', () => finish(false), { signal: controller.signal });
  });
}

export async function currentUser() {
  const { data } = await getSupabase().auth.getUser();
  return data.user;
}

export async function signOut() {
  return getSupabase().auth.signOut();
}

export function safeNext(next: string | null | undefined) {
  return next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/[\u0000-\u001f]/.test(next) ? next : '/';
}

export function authUrl(base: string, page: string, next?: string | null) {
  const url = `${base}/account/${page ? `${page}/` : ''}`;
  return next ? `${url}?next=${encodeURIComponent(safeNext(next))}` : url;
}

export function pageBase() {
  return /^\/(en|es)(?=\/|$)/.exec(location.pathname)?.[0] || '';
}

export function pageNext() {
  const next = new URLSearchParams(location.search).get('next');
  return next ? safeNext(next) : null;
}

export type AuthLabels = Record<'general' | 'invalid_credentials' | 'email_not_confirmed' | 'user_already_exists' | 'weak_password' | 'over_email_send_rate_limit' | 'captcha_failed' | 'same_password', string>;

export function errorText(error: unknown, labels: AuthLabels) {
  const value = error as { code?: string; message?: string; status?: number } | null;
  const code = value?.code || '';
  if (code in labels && code !== 'general') return labels[code as keyof AuthLabels];
  if (value?.message === 'User already registered') return labels.user_already_exists;
  if (value?.status === 429) return labels.over_email_send_rate_limit;
  // Код ошибки в конце помогает понять причину по скриншоту, не раскрывая текст Supabase
  const hint = code || (value?.status ? `HTTP ${value.status}` : '');
  return hint ? `${labels.general} (${hint})` : labels.general;
}

export function labelsOf(el: HTMLElement): AuthLabels {
  return JSON.parse(el.dataset.labels || '{}') as AuthLabels;
}

// После переходов Astro подключает обработчики к новым элементам страницы.
export function onPage(selector: string, init: (el: HTMLElement) => void) {
  const seen = new WeakSet<HTMLElement>();
  const run = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && !seen.has(el)) { seen.add(el); init(el); }
  };
  document.addEventListener('astro:page-load', run);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

type Captcha = { token(): string | undefined; reset(): void };
type Turnstile = {
  render(el: HTMLElement, options: { sitekey: string }): string;
  getResponse(id: string): string;
  reset(id: string): void;
};
declare global { interface Window { turnstile?: Turnstile } }
let turnstileScript: Promise<void> | undefined;

export async function mountCaptcha(el: HTMLElement): Promise<Captcha> {
  if (!TURNSTILE_SITE_KEY) return { token: () => undefined, reset() {} };
  turnstileScript ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      turnstileScript = undefined;
      reject(new Error('turnstile'));
    };
    document.head.append(script);
  });
  await turnstileScript;
  const id = window.turnstile!.render(el, { sitekey: TURNSTILE_SITE_KEY });
  return {
    token: () => window.turnstile?.getResponse(id) || undefined,
    reset: () => window.turnstile?.reset(id),
  };
}

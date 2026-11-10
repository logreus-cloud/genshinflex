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
const AUTH_PKCE = 'gf:auth.pkce';
type AuthExpect = { kind: 'email'; email: string } | { kind: 'user'; id: string };
type AuthIdentity = { email?: unknown; sub?: unknown };

export async function startOAuth(provider: 'discord' | 'google', redirectTo: string): Promise<void> {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  localStorage.setItem(AUTH_PKCE, JSON.stringify({ verifier, at: Date.now() }));
  location.assign(`${SUPABASE_URL}/auth/v1/authorize?${new URLSearchParams({ provider, redirect_to: redirectTo, code_challenge: challenge, code_challenge_method: 's256' })}`);
}

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

// Метка подходит, только если токен относится к попытке входа, начатой в этом браузере:
// письмо — на ту же почту, привязка — к тому же аккаунту
function pendingMatches(identity: AuthIdentity): boolean {
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
    const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
    const matches = fresh && (
      (mark!.kind === 'email' && !!email && mark!.email === email)
      || (mark!.kind === 'user' && typeof identity.sub === 'string' && mark!.id === identity.sub)
    );
    // Использованную или просроченную метку убираем, свежую несовпавшую оставляем.
    // Значение сверяем, чтобы не стереть метку более новой попытки из другой вкладки
    if ((matches || !fresh) && localStorage.getItem(AUTH_PENDING) === raw) localStorage.removeItem(AUTH_PENDING);
    return matches;
  } catch { return false; }
}

export async function consumeUrlSession(options?: { confirm?: (email: string) => Promise<boolean>; signal?: AbortSignal }): Promise<'none' | 'ok' | 'error' | 'declined' | 'aborted'> {
  try {
    const tokenRequest = async (grant: 'pkce' | 'refresh_token', body: object) => {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
      if (!response.ok) return null;
      const data = await response.json() as { access_token?: unknown; refresh_token?: unknown; user?: { id?: unknown; email?: unknown } } | null;
      if (typeof data?.access_token !== 'string' || typeof data.refresh_token !== 'string'
        || typeof data.user?.id !== 'string') return null;
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: { id: data.user.id, email: typeof data.user.email === 'string' ? data.user.email : undefined },
      };
    };
    const query = new URLSearchParams(location.search);
    let tokens: Awaited<ReturnType<typeof tokenRequest>>;
    if (query.has('code')) {
      const code = query.get('code') || '';
      query.delete('code');
      const search = query.toString();
      history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
      const raw = localStorage.getItem(AUTH_PKCE);
      localStorage.removeItem(AUTH_PKCE);
      const saved = JSON.parse(raw || 'null') as { verifier?: unknown; at?: unknown } | null;
      const age = Date.now() - (typeof saved?.at === 'number' ? saved.at : NaN);
      if (!code || typeof saved?.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.verifier)
        || !Number.isFinite(age) || age < 0 || age > 10 * 60 * 1000) return 'error';
      tokens = await tokenRequest('pkce', { auth_code: code, code_verifier: saved.verifier });
      if (!tokens) return 'error';
    } else {
      const hash = new URLSearchParams(location.hash.slice(1));
      if (!hash.has('access_token') && !hash.has('refresh_token')) return 'none';
      const refreshToken = hash.get('refresh_token') || '';
      history.replaceState(null, '', location.pathname + location.search);
      if (!refreshToken) return 'error';
      tokens = await tokenRequest('refresh_token', { refresh_token: refreshToken });
      if (!tokens) return 'error';
      if (options?.signal?.aborted) return 'aborted';
      const { user } = tokens;
      if (!pendingMatches({ email: user.email, sub: user.id })) {
        let confirmed = false;
        try { confirmed = await options?.confirm?.(user.email || user.id) ?? false; }
        catch { return options?.signal?.aborted ? 'aborted' : 'declined'; }
        if (options?.signal?.aborted) return 'aborted';
        if (!confirmed) return 'declined';
      }
    }
    if (options?.signal?.aborted) return 'aborted';
    const { data, error } = await getSupabase().auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
    if (error) return 'error';
    if (data.session?.user.id !== tokens.user.id) {
      try { await getSupabase().auth.signOut({ scope: 'local' }); } catch {}
      return 'error';
    }
    return 'ok';
  } catch { return options?.signal?.aborted ? 'aborted' : 'error'; }
}

export function confirmUrlSession(root: HTMLElement, email: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || !root.isConnected) return Promise.resolve(false);
  const panel = root.querySelector<HTMLElement>('[data-auth-confirm]')!;
  panel.querySelector<HTMLElement>('[data-auth-confirm-message]')!.textContent = (root.dataset.confirm || '').replace('{email}', email);
  panel.hidden = false;
  return new Promise((resolve) => {
    const controller = new AbortController();
    const finish = (value: boolean) => { controller.abort(); panel.hidden = true; resolve(value); };
    panel.querySelector('[data-auth-continue]')!.addEventListener('click', () => finish(true), { signal: controller.signal });
    panel.querySelector('[data-auth-cancel]')!.addEventListener('click', () => finish(false), { signal: controller.signal });
    document.addEventListener('astro:before-swap', () => finish(false), { signal: controller.signal });
    signal?.addEventListener('abort', () => finish(false), { signal: controller.signal, once: true });
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

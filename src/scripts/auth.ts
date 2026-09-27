import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, TURNSTILE_SITE_KEY } from '../lib/platform';

let client: ReturnType<typeof createClient> | undefined;

export function getSupabase() {
  return client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      flowType: 'implicit',
      persistSession: true,
      detectSessionInUrl: true,
      autoRefreshToken: true,
      storageKey: 'gf:auth',
    },
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
    script.onerror = () => reject(new Error('turnstile'));
    document.head.append(script);
  });
  await turnstileScript;
  const id = window.turnstile!.render(el, { sitekey: TURNSTILE_SITE_KEY });
  return {
    token: () => window.turnstile?.getResponse(id) || undefined,
    reset: () => window.turnstile?.reset(id),
  };
}

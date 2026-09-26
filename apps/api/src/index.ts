import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { userIdFromToken } from './lib/auth.ts';
import type { Env } from './lib/env.ts';
import { verifySanityWebhook } from './lib/sanity-webhook.ts';
import { verifyTelegram } from './lib/telegram.ts';
import { telegramLogin } from './lib/telegram-login.ts';

const app = new Hono<{ Bindings: Env }>();
const version = '0.2.0';

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = origin && c.env.SITE_ORIGINS?.split(',').map((item) => item.trim()).includes(origin);
  if (!allowed) return next();

  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Vary', 'Origin');
  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return c.body(null, 204);
  }
  return next();
});

app.get('/health', (c) => c.json({ ok: true, version }));

app.get('/me', async (c) => {
  const authorization = c.req.header('Authorization');
  const token = /^Bearer (.+)$/i.exec(authorization || '')?.[1];
  if (!token) return c.json({ error: 'Требуется авторизация' }, 401);

  const id = await userIdFromToken(token, c.env);
  if (!id) return c.json({ error: 'Требуется авторизация' }, 401);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Сервис недоступен' }, 503);
  }

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
  if (error || !data) return c.json({ error: 'Профиль не найден' }, 404);
  return c.json(data);
});

app.post('/auth/telegram', async (c) => {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) return c.json({ error: 'Сервис недоступен' }, 503);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Неверный JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Неверные данные' }, 400);
  const input = body as { auth?: unknown; lang?: unknown };
  const telegram = await verifyTelegram(input.auth, c.env.TELEGRAM_BOT_TOKEN, Date.now(), 3_600_000);
  if (!telegram) return c.json({ error: 'Неверная подпись Telegram' }, 401);
  const auth = input.auth as Record<string, unknown>;
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const token_hash = await telegramLogin(supabase, {
      ...telegram,
      first_name: typeof auth.first_name === 'string' ? auth.first_name : undefined,
      last_name: typeof auth.last_name === 'string' ? auth.last_name : undefined,
      photo_url: typeof auth.photo_url === 'string' ? auth.photo_url : undefined,
    }, typeof input.lang === 'string' ? input.lang : undefined);
    return c.json({ ok: true, token_hash });
  } catch {
    return c.json({ error: 'Сервис недоступен' }, 500);
  }
});

app.post('/hooks/sanity', async (c) => {
  if (!c.env.SANITY_WEBHOOK_SECRET || !c.env.CF_DEPLOY_HOOK_URL) {
    return c.json({ error: 'Сервис недоступен' }, 503);
  }
  const body = await c.req.text();
  const valid = await verifySanityWebhook(
    body, c.req.header('sanity-webhook-signature') || null, c.env.SANITY_WEBHOOK_SECRET,
  );
  if (!valid) return c.json({ error: 'Неверная подпись Sanity' }, 401);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(c.env.CF_DEPLOY_HOOK_URL, {
      method: 'POST',
      signal: controller.signal,
    });
    if (!response.ok) return c.json({ error: 'Не удалось запустить сборку' }, 502);
  } catch {
    return c.json({ error: 'Не удалось запустить сборку' }, 502);
  } finally {
    clearTimeout(timer);
  }
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'Не найдено' }, 404));
app.onError((_error, c) => c.json({ error: 'Внутренняя ошибка' }, 500));

export default app;

// Приём обратной связи: проверка, защита от спама, запись в D1. Читать сообщения: npm run feedback
import { feedbackMessages, sendAll, type DiscordEnv } from '../lib/discord';

interface Env extends DiscordEnv { DB: D1Database }
interface Ctx { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void }
type D1Database = { prepare: (q: string) => { bind: (...v: unknown[]) => { first: <T>() => Promise<T | null>; run: () => Promise<{ meta?: { last_row_id?: number } }> } } };

const KINDS = new Set(['data', 'idea', 'bug', 'other']);
const LIMIT_PER_HOUR = 5;

export async function onRequestPost({ request, env, waitUntil }: Ctx) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Не удалось прочитать форму' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Не удалось прочитать форму' }, 400);

  // Скрытое поле-ловушка: человек его не видит, бот заполняет. Отвечаем «успешно», чтобы бот не подбирал обход.
  if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true }, 201);

  const kind = String(body.kind ?? '');
  const message = String(body.message ?? '').trim();
  const contact = String(body.contact ?? '').trim().slice(0, 120);
  const page = String(body.page ?? '').trim().slice(0, 200);
  if (!KINDS.has(kind)) return json({ error: 'Выберите тип сообщения' }, 400);
  if (message.length < 10) return json({ error: 'Напишите хотя бы пару предложений — от 10 символов' }, 400);
  if (message.length > 3000) return json({ error: 'Слишком длинно: до 3000 символов' }, 400);

  // Храним не IP, а его хэш — только чтобы ограничить частоту
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`genshinflex:${ip}`));
  const ipHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')",
  ).bind(ipHash).first<{ n: number }>();
  if ((recent?.n ?? 0) >= LIMIT_PER_HOUR) return json({ error: 'Слишком много сообщений подряд — попробуйте через час' }, 429);

  const result = await env.DB.prepare('INSERT INTO feedback (kind, page, message, contact, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(kind, page || null, message, contact || null, ipHash).run();
  waitUntil(sendAll(feedbackMessages(env, { id: result.meta?.last_row_id, kind, page: page || null, message })));
  return json({ ok: true }, 201);
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Админка: заявки гайдов и обратная связь. Доступ проверяет _middleware.ts (Cloudflare Access).
// GET  /api/admin/inbox?status=new|all — списки; POST { type: 'guide' | 'feedback', id, status } — сменить статус
interface Env { DB: D1Database }
interface Ctx { request: Request; env: Env; data: { admin?: string } }
type Stmt = { bind: (...v: unknown[]) => Stmt; all: <T>() => Promise<{ results: T[] }>; first: <T>() => Promise<T | null>; run: () => Promise<{ meta: { changes: number } }> };
type D1Database = { prepare: (q: string) => Stmt };

const GUIDE_STATUS = new Set(['pending', 'approved', 'rejected']);
const FEEDBACK_STATUS = new Set(['new', 'done']);

export async function onRequestGet({ request, env, data }: Ctx) {
  const all = new URL(request.url).searchParams.get('status') === 'all';
  const guides = await env.DB.prepare(
    `SELECT id, created_at, character, mode, author, contact, comment, payload, status FROM guide_submissions ${all ? '' : "WHERE status = 'pending'"} ORDER BY id DESC LIMIT 100`,
  ).all<Record<string, unknown>>();
  const feedback = await env.DB.prepare(
    `SELECT id, created_at, kind, page, message, contact, status FROM feedback ${all ? '' : "WHERE status = 'new'"} ORDER BY id DESC LIMIT 200`,
  ).all<Record<string, unknown>>();
  const counts = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM guide_submissions WHERE status = 'pending') AS guides, (SELECT COUNT(*) FROM feedback WHERE status = 'new') AS feedback",
  ).first<{ guides: number; feedback: number }>();
  return json({
    admin: data.admin,
    counts,
    guides: guides.results.map((g) => ({ ...g, payload: JSON.parse(String(g.payload)) })),
    feedback: feedback.results,
  });
}

export async function onRequestPost({ request, env }: Ctx) {
  const body = (await request.json().catch(() => ({}))) as { type?: string; id?: number; status?: string };
  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ error: 'Нет номера' }, 400);
  if (body.type === 'guide' && GUIDE_STATUS.has(body.status ?? '')) {
    await env.DB.prepare('UPDATE guide_submissions SET status = ? WHERE id = ?').bind(body.status, id).run();
  } else if (body.type === 'feedback' && FEEDBACK_STATUS.has(body.status ?? '')) {
    await env.DB.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(body.status, id).run();
  } else return json({ error: 'Неизвестное действие' }, 400);
  return json({ ok: true });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// Приём гайдов из редактора: проверка, защита от спама, запись в очередь модерации (D1).
// На сайт ничего не попадает само: заявки смотрим через npm run guides, одобренную превращаем в файл билда — npm run guide:md <id>
interface Env { DB: D1Database }
interface Ctx { request: Request; env: Env }
type D1Database = { prepare: (q: string) => { bind: (...v: unknown[]) => { first: <T>() => Promise<T | null>; run: () => Promise<unknown> } } };

const LIMIT_PER_HOUR = 3;
const MAX_PAYLOAD = 60_000;
const slug = /^[a-z0-9-]{2,60}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const slugs = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && slug.test(x)).slice(0, max) : []);
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : []);

export async function onRequestPost({ request, env }: Ctx) {
  const raw = await request.text();
  if (raw.length > MAX_PAYLOAD) return json({ error: 'Гайд слишком большой — сократите текст' }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Не удалось прочитать гайд' }, 400); }

  // Скрытое поле-ловушка для ботов
  if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true }, 201);

  const g = (body.guide ?? {}) as Record<string, unknown>;
  const character = str(g.character, 60);
  if (!slug.test(character)) return json({ error: 'Выберите персонажа' }, 400);
  const author = str(body.author, 60);
  if (author.length < 2) return json({ error: 'Укажите имя или ник — так мы подпишем гайд' }, 400);
  const text = str(g.body, 20_000);

  // Сохраняем только известные поля в понятной форме — в таком виде заявку легко превратить в файл билда
  const guide = {
    character,
    // Язык страницы, на которой писали гайд: русский идёт в файл билда, en/es — в перевод текста
    lang: body.lang === 'en' || body.lang === 'es' ? body.lang : 'ru',
    role: str(g.role, 60),
    patch: str(g.patch, 10),
    weapons: list(g.weapons, 10).map((w) => ({ slug: str(w.slug, 80), note: str(w.note, 200) })).filter((w) => slug.test(w.slug)),
    artifacts: list(g.artifacts, 10).map((a) => ({ sets: slugs(a.sets, 2), note: str(a.note, 200) })).filter((a) => a.sets.length),
    mainStats: Object.fromEntries(['sands', 'goblet', 'circlet'].map((k) => [k, str((g.mainStats as Record<string, unknown> | undefined)?.[k], 80)])),
    substats: (Array.isArray(g.substats) ? g.substats : []).map((s) => str(s, 60)).filter(Boolean).slice(0, 8),
    talents: (Array.isArray(g.talents) ? g.talents : []).filter((t) => ['normal', 'skill', 'burst'].includes(t as string)).slice(0, 3),
    teams: list(g.teams, 8).map((t) => ({ name: str(t.name, 80), members: slugs(t.members, 4), note: str(t.note, 300) })).filter((t) => t.members.length),
    body: text,
  };
  if (!guide.weapons.length && !guide.artifacts.length && !guide.teams.length && text.length < 50)
    return json({ error: 'Гайд почти пустой: добавьте оружие, артефакты, команды или хотя бы пару абзацев текста' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`genshinflex:${ip}`));
  const ipHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM guide_submissions WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')",
  ).bind(ipHash).first<{ n: number }>();
  if ((recent?.n ?? 0) >= LIMIT_PER_HOUR) return json({ error: 'Слишком много гайдов подряд — попробуйте через час' }, 429);

  await env.DB.prepare('INSERT INTO guide_submissions (character, mode, author, contact, comment, payload, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(character, body.mode === 'edit' ? 'edit' : 'new', author, str(body.contact, 120) || null, str(body.comment, 1000) || null, JSON.stringify(guide), ipHash).run();
  return json({ ok: true }, 201);
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

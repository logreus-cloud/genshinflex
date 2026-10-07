// Один основной адрес для поисковиков: www.genshinflex.com → genshinflex.com (301, путь и параметры сохраняются)
// Копия значений по умолчанию из src/lib/platform.ts: там import.meta.env, которого нет в Pages Functions.
// Публичный ключ — тот же, что уходит в браузер.
const SUPABASE_URL = 'https://qhfufvdculphsqxuqxsw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3IqstX40IpHaa2g9_o4wVg_n54We4l_';
// Типы Workers в проекте не подключены — минимальное объявление HTMLRewriter
declare class HTMLRewriter {
  on(selector: string, handlers: { element(element: { setAttribute(name: string, value: string): void; setInnerContent(content: string, options?: { html: boolean }): void; remove(): void }): void }): HTMLRewriter;
  transform(response: Response): Response;
}

interface Ctx { request: Request; next: () => Promise<Response>; env: { ASSETS: { fetch: typeof fetch } } }

export async function onRequest({ request, next, env }: Ctx) {
  const url = new URL(request.url);
  if (url.hostname === 'www.genshinflex.com') {
    url.hostname = 'genshinflex.com';
    return Response.redirect(url.toString(), 301);
  }
  const match = url.pathname.match(/^\/(?:(en|es)\/)?u\/([^/]+)\/?$/);
  if (match) {
    const prefix = match[1] ? `/${match[1]}` : '';
    const shell = await env.ASSETS.fetch(new URL(`${prefix}/u/`, request.url));
    const headers = new Headers(shell.headers);
    headers.set('Cache-Control', 'public, max-age=60');
    const page = (status: number) => new Response(shell.body, { status, headers });
    try {
      const nick = decodeURIComponent(match[2]);
      const response = await fetch(`${SUPABASE_URL}/rest/v1/public_profiles?select=nickname,display_name,custom&nickname=eq.${encodeURIComponent(nick)}&limit=1`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error();
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error();
      if (!rows.length) return page(404);
      const row = rows[0] as { nickname?: unknown; display_name?: unknown; custom?: unknown };
      const custom = row.custom && typeof row.custom === 'object' && !Array.isArray(row.custom) ? row.custom as { nick?: unknown; about?: unknown } : {};
      const name = (typeof custom.nick === 'string' && custom.nick) || (typeof row.display_name === 'string' && row.display_name) || String(row.nickname || nick);
      const title = `${name} — GenshinFlex`;
      const fallback = match[1] === 'en' ? `Player ${name}'s profile on GenshinFlex.` :
        match[1] === 'es' ? `Perfil del jugador ${name} en GenshinFlex.` : `Профиль игрока ${name} на GenshinFlex.`;
      const description = (typeof custom.about === 'string' && custom.about ? custom.about : fallback).slice(0, 160);
      const canonical = new URL(url.pathname.replace(/\/?$/, '/'), url.origin).toString();
      return new HTMLRewriter()
        .on('title', { element(element) { element.setInnerContent(title, { html: false }); } })
        .on('meta[property="og:title"]', { element(element) { element.setAttribute('content', title); } })
        .on('meta[name="twitter:title"]', { element(element) { element.setAttribute('content', title); } })
        .on('meta[name="description"]', { element(element) { element.setAttribute('content', description); } })
        .on('meta[property="og:description"]', { element(element) { element.setAttribute('content', description); } })
        .on('link[rel="canonical"]', { element(element) { element.setAttribute('href', canonical); } })
        .on('meta[property="og:url"]', { element(element) { element.setAttribute('content', canonical); } })
        .transform(page(200));
    } catch { return page(200); }
  }
  const forum = url.pathname.match(/^\/(?:(en|es)\/)?forum\/t\/(\d+)\/?$/);
  if (forum) {
    const prefix = forum[1] ? `/${forum[1]}` : '';
    const shell = await env.ASSETS.fetch(new URL(`${prefix}/forum/t/`, request.url));
    const headers = new Headers(shell.headers);
    headers.set('Cache-Control', 'public, max-age=60');
    const page = (status: number) => new Response(shell.body, { status, headers });
    const rpc = async (name: string, body: Record<string, unknown>) => {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error();
      return response.json() as Promise<Record<string, unknown>[]>;
    };
    try {
      const thread = (await rpc('forum_thread', { p_id: Number(forum[2]) }))[0];
      if (!thread) return page(404);
      const post = (await rpc('forum_posts', { p_thread: Number(forum[2]), p_limit: 1 }))[0];
      const snippet = String(post?.body ?? '').replace(/\|\|[\s\S]*?\|\|/g, '[спойлер]').replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1').replace(/(?:^|\n)[>*-] ?/g, ' ').replace(/[*_~`]/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const forumLabel = forum[1] === 'en' ? 'Forum' : forum[1] === 'es' ? 'Foro' : 'Форум';
      const title = `${String(thread.title)} — ${forumLabel} GenshinFlex`;
      const canonical = new URL(`/forum/t/${Number(forum[2])}/`, url.origin).toString();
      return new HTMLRewriter()
        .on('meta[name="robots"]', { element(element) { element.remove(); } })
        .on('link[rel="alternate"][hreflang]', { element(element) { element.remove(); } })
        .on('title', { element(element) { element.setInnerContent(title, { html: false }); } })
        .on('meta[property="og:title"], meta[name="twitter:title"]', { element(element) { element.setAttribute('content', title); } })
        .on('meta[name="description"], meta[property="og:description"]', { element(element) { element.setAttribute('content', snippet); } })
        .on('link[rel="canonical"]', { element(element) { element.setAttribute('href', canonical); } })
        .on('meta[property="og:url"]', { element(element) { element.setAttribute('content', canonical); } })
        .transform(page(200));
    } catch { headers.set('Cache-Control', 'no-store'); headers.set('Retry-After', '120'); return page(503); }
  }
  return next();
}

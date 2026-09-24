// Доступ к /api/admin/*: только через Cloudflare Access.
// Access сам не пускает чужих на /admin и /api/admin, а здесь мы дополнительно проверяем подпись его токена,
// аудиторию приложения и почту — на случай, если правило Access случайно снимут.
// Настройки (wrangler.toml → [vars]): ACCESS_TEAM — имя команды Zero Trust, ACCESS_AUD — Audience tag приложения,
// ADMIN_EMAILS — почты через запятую. Для локальной разработки: ADMIN_DEV=1 в .dev.vars (в репозиторий не попадает).
interface Env { ACCESS_TEAM?: string; ACCESS_AUD?: string; ADMIN_EMAILS?: string; ADMIN_DEV?: string }
interface Ctx { request: Request; env: Env; next: () => Promise<Response>; data: Record<string, unknown> }
type Jwk = JsonWebKey & { kid: string };

let certs: { keys: Jwk[]; at: number } | null = null;
async function keys(team: string) {
  // Ключи Access меняются редко — держим их час
  if (!certs || Date.now() - certs.at > 3_600_000) {
    const r = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
    certs = { keys: ((await r.json()) as { keys: Jwk[] }).keys, at: Date.now() };
  }
  return certs.keys;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const part = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function verify(token: string, env: Env): Promise<string | null> {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  const header = part(h), payload = part(p);
  const jwk = (await keys(env.ACCESS_TEAM!)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!ok || !aud.includes(env.ACCESS_AUD) || payload.exp * 1000 < Date.now()) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return null;
  return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
}

export async function onRequest({ request, env, next, data }: Ctx) {
  // Только для wrangler pages dev: переменная задаётся в .dev.vars, в рабочем окружении её нет — не добавляйте её в настройки Pages
  if (env.ADMIN_DEV === '1') { data.admin = 'dev'; return next(); }
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD || !env.ADMIN_EMAILS) return json({ error: 'Админка ещё не настроена: нет ACCESS_TEAM, ACCESS_AUD или ADMIN_EMAILS' }, 503);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const email = token ? await verify(token, env).catch(() => null) : null;
  const allowed = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase());
  if (!email || !allowed.includes(email)) return json({ error: 'Нет доступа' }, 403);
  data.admin = email;
  return next();
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

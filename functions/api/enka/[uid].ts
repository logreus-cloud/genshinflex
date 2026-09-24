// Прокси к enka.network: их API не отдаёт CORS-заголовки, поэтому браузер не может обратиться напрямую.
// Отдаём ответ как есть и кэшируем на минуту — столько же держит его сама enka (ttl).
interface Ctx { params: { uid: string }; request: Request; waitUntil: (p: Promise<unknown>) => void }

export async function onRequestGet({ params, request, waitUntil }: Ctx) {
  const uid = String(params.uid);
  if (!/^\d{9,10}$/.test(uid)) return json({ error: 'UID — это 9 или 10 цифр' }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(new URL(`/api/enka/${uid}`, request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const upstream = await fetch(`https://enka.network/api/uid/${uid}`, { headers: { 'User-Agent': 'GenshinFlex/1.0' } });
  // У enka свои коды ошибок: 400 — неверный UID, 404 — игрок не найден, 424 — техработы, 429 — лимит, 5xx — сбой
  const messages: Record<number, string> = {
    400: 'Неверный формат UID', 404: 'Игрок с таким UID не найден', 424: 'На enka.network идут технические работы',
    429: 'Слишком много запросов — подождите минуту', 500: 'enka.network временно недоступна', 503: 'enka.network временно недоступна',
  };
  if (!upstream.ok) return json({ error: messages[upstream.status] ?? `enka.network ответила ${upstream.status}` }, upstream.status);

  const res = new Response(upstream.body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  });
  waitUntil(cache.put(key, res.clone()));
  return res;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

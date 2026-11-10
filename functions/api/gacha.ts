// Прокси к истории молитв HoYoverse: API не отдаёт CORS-заголовки, поэтому браузер не может обратиться напрямую.
// Пропускаем только нужные параметры, одну страницу за запрос, ничего не сохраняем и не логируем.
const UPSTREAM = 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog';
const ALLOWED = ['authkey', 'authkey_ver', 'sign_type', 'lang', 'gacha_type', 'page', 'size', 'end_id', 'game_biz', 'region'];
const GACHA_TYPES = new Set(['100', '200', '301', '302', '400', '500']);

export async function onRequestGet({ request }: { request: Request }) {
  const src = new URL(request.url).searchParams;
  const authkey = src.get('authkey');
  if (!authkey) return json({ error: 'В ссылке нет authkey — скопируйте ссылку заново' }, 400);
  if (authkey.length < 100 || authkey.length > 2000) return json({ error: 'Неверный authkey' }, 400);
  if (!GACHA_TYPES.has(src.get('gacha_type') ?? '')) return json({ error: 'Неизвестный тип баннера' }, 400);
  if (src.has('end_id') && !/^\d{1,32}$/.test(src.get('end_id') ?? '')) return json({ error: 'Неверный end_id' }, 400);
  if (src.has('size') && (!/^[1-9]\d*$/.test(src.get('size') ?? '') || Number(src.get('size')) > 20)) return json({ error: 'Неверный size' }, 400);
  if (src.has('page') && (!/^[1-9]\d*$/.test(src.get('page') ?? '') || Number(src.get('page')) > 1000)) return json({ error: 'Неверный page' }, 400);

  const url = new URL(UPSTREAM);
  for (const k of ALLOWED) { const v = src.get(k); if (v) url.searchParams.set(k, v); }
  url.searchParams.set('size', '20');
  if (!url.searchParams.has('authkey_ver')) url.searchParams.set('authkey_ver', '1');
  if (!url.searchParams.has('lang')) url.searchParams.set('lang', 'ru');

  let upstream: Response;
  // Тело читаем здесь же: таймаут должен покрывать и медленную отдачу тела, а не только заголовки
  let payload: string;
  try {
    upstream = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    payload = await upstream.text();
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      return json({ error: 'HoYoverse не ответила вовремя' }, 504);
    throw error;
  }
  return new Response(payload, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

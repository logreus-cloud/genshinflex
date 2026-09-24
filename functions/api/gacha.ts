// Прокси к истории молитв HoYoverse: API не отдаёт CORS-заголовки, поэтому браузер не может обратиться напрямую.
// Пропускаем только нужные параметры, одну страницу за запрос, ничего не сохраняем и не логируем.
const UPSTREAM = 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog';
const ALLOWED = ['authkey', 'authkey_ver', 'sign_type', 'lang', 'gacha_type', 'page', 'size', 'end_id', 'game_biz', 'region'];
const GACHA_TYPES = new Set(['100', '200', '301', '302', '500']);

export async function onRequestGet({ request }: { request: Request }) {
  const src = new URL(request.url).searchParams;
  if (!src.get('authkey')) return json({ error: 'В ссылке нет authkey — скопируйте ссылку заново' }, 400);
  if (!GACHA_TYPES.has(src.get('gacha_type') ?? '')) return json({ error: 'Неизвестный тип баннера' }, 400);

  const url = new URL(UPSTREAM);
  for (const k of ALLOWED) { const v = src.get(k); if (v) url.searchParams.set(k, v); }
  url.searchParams.set('size', '20');
  if (!url.searchParams.has('authkey_ver')) url.searchParams.set('authkey_ver', '1');
  if (!url.searchParams.has('lang')) url.searchParams.set('lang', 'ru');

  const upstream = await fetch(url.toString());
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

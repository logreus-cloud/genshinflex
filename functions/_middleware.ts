// Один основной адрес для поисковиков: www.genshinflex.com → genshinflex.com (301, путь и параметры сохраняются)
interface Ctx { request: Request; next: () => Promise<Response> }

export async function onRequest({ request, next }: Ctx) {
  const url = new URL(request.url);
  if (url.hostname === 'www.genshinflex.com') {
    url.hostname = 'genshinflex.com';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}

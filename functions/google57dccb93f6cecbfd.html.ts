// Файл подтверждения Google Search Console. Отдаётся функцией, потому что Cloudflare Pages
// перенаправляет статические *.html на адрес без расширения, а Google нужен прямой ответ 200.
export const onRequestGet = () =>
  new Response('google-site-verification: google57dccb93f6cecbfd.html', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });

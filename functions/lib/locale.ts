export const LANG_COOKIE = 'gf_lang';

const excluded = new Set(['en', 'es', 'api', 'admin', 'data', 'download', '_astro', 'img', 'gcsim', 'elements', 'pagefind']);
const russianFamiliar = new Set(['uk', 'be', 'kk', 'uz', 'ky', 'tg', 'tk', 'az', 'hy', 'ka']);

export function localeRedirect(request: Request): string | null {
  const url = new URL(request.url);
  const segments = url.pathname.split('/');
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (request.headers.get('Sec-Fetch-Dest') !== 'document') return null;
  if (request.headers.get('Sec-Fetch-Site') === 'same-origin') return null;
  const agent = request.headers.get('User-Agent');
  if (!agent || /bot|crawl|spider|slurp|preview|lighthouse|facebookexternalhit|headless/i.test(agent)) return null;
  if (excluded.has(segments[1]) || segments.filter(Boolean).at(-1)?.includes('.')) return null;

  const cookie = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${LANG_COOKIE}=`));
  const chosen = cookie?.slice(LANG_COOKIE.length + 1);
  if (chosen === 'ru') return null;
  if (chosen === 'en' || chosen === 'es') return `/${chosen}${url.pathname}${url.search}`;

  const languages = (request.headers.get('Accept-Language') ?? '').split(',').flatMap((item, index) => {
    const [tag, quality] = item.trim().split(';');
    const match = quality?.trim().match(/^q\s*=\s*(\d+(?:\.\d*)?|\.\d+)$/i);
    const q = quality === undefined ? 1 : Number(match?.[1]);
    const base = tag.trim().split('-')[0].toLowerCase();
    return q > 0 && Number.isFinite(q) && base && base !== '*' ? [{ base, q, index }] : [];
  }).sort((a, b) => b.q - a.q || a.index - b.index);
  // Русский язык в списке всегда оставляет основную версию, независимо от приоритета.
  if (languages.some(({ base }) => base === 'ru')) return null;
  const chosenLanguage = languages.find(({ base }) => base === 'en' || base === 'es')?.base;
  if (chosenLanguage) return `/${chosenLanguage}${url.pathname}${url.search}`;
  // Для этих языков оставляем русскую версию.
  if (languages.some(({ base }) => russianFamiliar.has(base))) return null;
  return languages.length ? `/en${url.pathname}${url.search}` : null;
}

export const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || 'https://qhfufvdculphsqxuqxsw.supabase.co';
export const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_KEY || 'sb_publishable_3IqstX40IpHaa2g9_o4wVg_n54We4l_';
export const API_URL = import.meta.env.PUBLIC_API_URL || 'https://api.genshinflex.com';
export const MAP_TILES_URL = (import.meta.env.PUBLIC_MAP_TILES_URL || 'https://tiles.genshinflex.com/map').replace(/\/+$/, '');
export const TELEGRAM_BOT = import.meta.env.PUBLIC_TELEGRAM_BOT || 'GenshinFlex_Bot';
export const TURNSTILE_SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '';

export function hoyolabMapUrl(lang: string): string {
  const code = lang === 'ru' ? 'ru-ru' : lang === 'es' ? 'es-es' : 'en-us';
  return `https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=${code}`;
}

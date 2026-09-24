// Перевод для браузера: только строки интерфейса (контент переводится при сборке и в клиент не попадает)
import en from './ui.en.json';
import es from './ui.es.json';

export type Lang = 'ru' | 'en' | 'es';
const DICTS: Record<Exclude<Lang, 'ru'>, Record<string, string>> = { en, es };
type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export const translate = (lang: Lang) => (key: string, vars?: Vars): string =>
  fill(lang === 'ru' || !key ? key : DICTS[lang][key] ?? key, vars);

// Язык страницы берётся из <html lang>
export const pageLang = (): Lang => {
  const l = typeof document !== 'undefined' ? document.documentElement.lang : 'ru';
  return l === 'en' || l === 'es' ? l : 'ru';
};

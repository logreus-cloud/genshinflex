// Перевод для браузера: только строки интерфейса (контент переводится при сборке и в клиент не попадает)
import ui from './ui.json';

export type Lang = 'ru' | 'en' | 'es';
const UI: Record<string, { en: string; es: string }> = ui;
type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export const translate = (lang: Lang) => (key: string, vars?: Vars): string =>
  fill(lang === 'ru' || !key || !/[А-Яа-яЁё]/.test(key) ? key : UI[key]?.[lang] ?? key, vars);

// Язык страницы берётся из <html lang>
export const pageLang = (): Lang => {
  const l = typeof document !== 'undefined' ? document.documentElement.lang : 'ru';
  return l === 'en' || l === 'es' ? l : 'ru';
};

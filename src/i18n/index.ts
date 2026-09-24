// Перевод интерфейса и контента. Ключ — сама русская строка: t('Персонажи') → 'Characters'.
// Нет перевода — показываем русский текст, а сборка записывает пропуск в .i18n-missing.json.
import uiEn from './ui.en.json';
import uiEs from './ui.es.json';
import contentEn from './content.en.json';
import contentEs from './content.es.json';

export type Lang = 'ru' | 'en' | 'es';
// На сервере доступны оба словаря: интерфейс и контент
const DICTS: Record<Exclude<Lang, 'ru'>, Record<string, string>> = { en: { ...contentEn, ...uiEn }, es: { ...contentEs, ...uiEs } };

type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export function translate(lang: Lang) {
  return (key: string, vars?: Vars): string => {
    // Строки без кириллицы (имена из данных, уже переведённые подписи) переводить не нужно
    if (lang === 'ru' || !key || !/[А-Яа-яЁё]/.test(key)) return fill(key, vars);
    const hit = DICTS[lang][key];
    if (hit === undefined) {
      const g = globalThis as { __i18nMissing?: Record<string, Set<string>> };
      if (typeof window === 'undefined') ((g.__i18nMissing ??= {})[lang] ??= new Set()).add(key);
      return fill(key, vars);
    }
    return fill(hit, vars);
  };
}

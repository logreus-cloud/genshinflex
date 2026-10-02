// Перевод интерфейса и контента. Строки интерфейса — в src/i18n/ui.json.
// Нет перевода — показываем русский текст, а сборка записывает пропуск в .i18n-missing.json.
import ui from './ui.json';
// Контент: шаблонные переводы генерирует npm run i18n:collect (content-auto.json), ручные — в content.manual.json и перекрывают их
import contentAuto from './content-auto.json';
import contentManual from './content.manual.json';

export type Lang = 'ru' | 'en' | 'es';
// На сервере доступны оба словаря: интерфейс и контент
const UI: Record<string, { en: string; es: string }> = ui;
const manual = Object.entries(contentManual as Record<string, { en: string; es: string }>);
const DICTS: Record<Exclude<Lang, 'ru'>, Record<string, string>> = {
  en: { ...contentAuto.en, ...Object.fromEntries(manual.map(([ru, value]) => [ru, value.en])) },
  es: { ...contentAuto.es, ...Object.fromEntries(manual.map(([ru, value]) => [ru, value.es])) },
};

type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export function translate(lang: Lang) {
  return (key: string, vars?: Vars): string => {
    // Строки без кириллицы (имена из данных, уже переведённые подписи) переводить не нужно
    if (lang === 'ru' || !key || !/[А-Яа-яЁё]/.test(key)) return fill(key, vars);
    const hit = UI[key]?.[lang] ?? DICTS[lang][key];
    if (hit === undefined) {
      const g = globalThis as { __i18nMissing?: Record<string, Set<string>> };
      if (typeof window === 'undefined') ((g.__i18nMissing ??= {})[lang] ??= new Set()).add(key);
      return fill(key, vars);
    }
    return fill(hit, vars);
  };
}

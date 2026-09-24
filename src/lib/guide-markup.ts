// Разметка текста гайда: подмножество Markdown + «баблы» и блоки-выноски.
// Один и тот же код рендерит превью в редакторе (в браузере) и страницу персонажа (при сборке),
// поэтому превью совпадает с тем, что увидят читатели.
//
//   ## Заголовок            ### Подзаголовок
//   **жирный**  *курсив*  ==выделение==  [текст](https://…)
//   - список                 1. нумерованный список        > цитата
//   {{char:furina}}  {{weapon:slug}}  {{set:slug}}  {{el:hydro}} — бабл с иконкой и ссылкой
//   {{текст}} — простой бабл, {{gold:текст}} — золотой
//   :::tip Заголовок … ::: — выноска (tip — совет, warn — важно, info — на заметку)

export type Kind = 'char' | 'weapon' | 'set' | 'el';
export interface Ref { name: string; icon?: string; href?: string; el?: string }
export type Lookup = (kind: Kind, slug: string) => Ref | undefined;
export type CalloutKind = 'tip' | 'warn' | 'info';

export const CALLOUT_TITLES: Record<CalloutKind, string> = { tip: 'Совет', warn: 'Важно', info: 'На заметку' };

interface Named { slug: string; name: string; icon?: string | null; element?: string }

// Справочник для баблов из списков данных сайта (на сервере — полные данные, в редакторе — /data/editor.json)
export function makeLookup(
  src: { characters: Named[]; weapons: Named[]; artifacts: Named[]; elements: Record<string, string> },
  base = '',
): Lookup {
  const maps = {
    char: new Map(src.characters.map((c) => [c.slug, { name: c.name, icon: c.icon ?? undefined, el: c.element, href: `${base}/characters/${c.slug}/` }])),
    weapon: new Map(src.weapons.map((w) => [w.slug, { name: w.name, icon: w.icon ?? undefined, href: `${base}/weapons/${w.slug}/` }])),
    set: new Map(src.artifacts.map((a) => [a.slug, { name: a.name, icon: a.icon ?? undefined, href: `${base}/artifacts/#${a.slug}` }])),
    el: new Map(Object.entries(src.elements).map(([k, v]) => [k, { name: v, el: k }])),
  } satisfies Record<Kind, Map<string, Ref>>;
  return (kind, slug) => maps[kind].get(slug);
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
// Только обычные ссылки: внешние https/http и внутренние пути сайта — никаких javascript: и data:
const safeUrl = (u: string) => (/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i.test(u) ? u : null);

function bubble(lookup: Lookup, kind: string, arg: string): string {
  if (kind === 'gold') return `<span class="chip gold">${arg}</span>`;
  const ref = lookup(kind as Kind, arg);
  if (!ref) return `<span class="chip" title="Не найдено">${kind}:${arg}</span>`;
  if (kind === 'el') return `<span class="chip" data-el="${ref.el}">${esc(ref.name)}</span>`;
  const img = ref.icon ? `<img src="${esc(ref.icon)}" alt="" loading="lazy" />` : '';
  const el = ref.el ? ` data-el="${ref.el}"` : '';
  const inner = `${img}${esc(ref.name)}`;
  return ref.href ? `<a class="chip gm-item"${el} href="${ref.href}">${inner}</a>` : `<span class="chip gm-item"${el}>${inner}</span>`;
}

function inline(text: string, lookup: Lookup): string {
  // Баблы и ссылки прячем за метки, чтобы **жирный** и *курсив* не задевали их атрибуты
  const kept: string[] = [];
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;
  let s = esc(text)
    .replace(/\{\{(char|weapon|set|el|gold):([^{}]+?)\}\}/g, (_m, k, a) => keep(bubble(lookup, k, k === 'gold' ? a.trim() : a.trim().toLowerCase())))
    .replace(/\{\{([^{}]+?)\}\}/g, (_m, a) => keep(`<span class="chip">${a.trim()}</span>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const href = safeUrl(url.replace(/&amp;/g, '&'));
      if (!href) return m;
      const ext = /^https?:/i.test(href) ? ' rel="noopener nofollow ugc" target="_blank"' : '';
      return keep(`<a href="${esc(href)}"${ext}>${label}</a>`);
    });
  s = s
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/==(?=\S)(.+?)(?<=\S)==/g, '<mark>$1</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)]);
}

export function renderGuide(src: string, lookup: Lookup, titles: Record<CalloutKind, string> = CALLOUT_TITLES): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let quote: string[] = [];

  const flush = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, lookup)).join('<br>')}</p>`);
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, lookup)}</li>`).join('')}</${list.tag}>`);
    if (quote.length) out.push(`<blockquote><p>${quote.map((l) => inline(l, lookup)).join('<br>')}</p></blockquote>`);
    para = []; list = null; quote = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^:::(tip|warn|info)\b\s*(.*)$/))) {
      flush();
      const inner: string[] = [];
      while (++i < lines.length && lines[i].trim() !== ':::') inner.push(lines[i]);
      const kind = m[1] as CalloutKind;
      out.push(`<aside class="callout ${kind}"><b>${inline(m[2] || titles[kind], lookup)}</b>${renderGuide(inner.join('\n'), lookup, titles)}</aside>`);
    } else if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
      flush();
      const tag = m[1].length === 3 ? 'h4' : 'h3';
      out.push(`<${tag}>${inline(m[2], lookup)}</${tag}>`);
    } else if ((m = line.match(/^(?:([-*•])|\d+[.)])\s+(.+)$/))) {
      const tag = m[1] ? 'ul' : 'ol';
      if (!list || list.tag !== tag || para.length || quote.length) { flush(); list = { tag, items: [] }; }
      list.items.push(m[2]);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      if (!quote.length) flush();
      quote.push(m[1]);
    } else if (!line) {
      flush();
    } else {
      if (list || quote.length) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
}

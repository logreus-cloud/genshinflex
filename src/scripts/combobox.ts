import { t } from './search';

export type ComboItem = {
  value: string;
  label: string;
  icon?: string | null;
  hint?: string;
  el?: string;
  rarity?: number;
  search?: string;
};

export const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
let nextId = 0;

// Список живёт в body, чтобы его не обрезали контейнеры формы.
export const combobox = (
  input: HTMLInputElement,
  items: () => ComboItem[],
  onPick: (item: ComboItem) => void,
  opts: { max?: number; emptyText?: string } = {},
) => {
  const originalAttributes = ['list', 'role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant', 'autocomplete']
    .map((name) => [name, input.getAttribute(name)] as const);
  const list = document.createElement('ul');
  const id = `cb-list-${++nextId}`;
  list.id = id;
  list.className = 'cb-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  document.body.append(list);
  input.removeAttribute('list');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id);
  input.setAttribute('autocomplete', 'off');

  let shown: ComboItem[] = [];
  let active = -1;
  let selecting = false;
  const max = Math.max(1, opts.max ?? 80);
  const position = () => {
    if (list.hidden) return;
    const rect = input.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth);
    list.style.width = `${width}px`;
    list.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - width))}px`;
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const up = below < Math.min(list.scrollHeight, 320) && above > below;
    list.style.maxHeight = `${Math.min(320, Math.max(0, (up ? above : below) - 6))}px`;
    list.style.top = `${up ? rect.top - Math.min(list.scrollHeight, 320, Math.max(0, above - 6)) - 4 : rect.bottom + 4}px`;
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('resize', position);
  };
  const setActive = (index: number) => {
    active = index;
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((node, i) => {
      node.setAttribute('aria-selected', String(i === active));
    });
    if (active >= 0) {
      const node = list.querySelectorAll<HTMLElement>('[role="option"]')[active];
      input.setAttribute('aria-activedescendant', node.id);
      if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const highlight = (label: string, query: string) => {
    if (!query) return esc(label);
    const at = norm(label).indexOf(query);
    return at < 0 ? esc(label) : `${esc(label.slice(0, at))}<mark>${esc(label.slice(at, at + query.length))}</mark>${esc(label.slice(at + query.length))}`;
  };
  const pick = (index: number) => {
    const item = shown[index];
    if (!item) return;
    close();
    selecting = true;
    try { onPick(item); } finally { selecting = false; }
  };
  const refresh = () => {
    const query = norm(input.value);
    const matches = items().filter((item) => !query || norm(item.label).includes(query) || norm(item.search ?? '').includes(query));
    shown = matches.slice(0, max);
    list.innerHTML = shown.map((item, i) => `<li id="${id}-${i}" role="option" class="cb-item${item.rarity ? ` r${esc(String(item.rarity))}` : ''}"${item.el ? ` data-el="${esc(item.el)}"` : ''} aria-selected="false" data-index="${i}">${item.icon ? `<img src="${esc(item.icon)}" alt="" width="36" height="36" loading="lazy">` : ''}<span><b>${highlight(item.label, query)}</b>${item.hint ? `<br><small>${esc(item.hint)}</small>` : ''}</span></li>`).join('')
      + (matches.length > shown.length ? `<li class="cb-note">${esc(t('Уточните запрос — показаны первые {n}', { n: shown.length }))}</li>` : '')
      + (!matches.length ? `<li class="cb-note">${esc(opts.emptyText ?? t('Ничего не найдено'))}</li>` : '');
    setActive(-1);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    position();
  };
  const onInput = () => { if (!selecting) refresh(); };
  const onKeydown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') { close(); return; }
    if (ev.key === 'Tab') { close(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (list.hidden) refresh();
      if (shown.length) setActive(active < 0 ? (ev.key === 'ArrowDown' ? 0 : shown.length - 1) : (active + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (ev.key === 'Enter' && !list.hidden && (active >= 0 || shown.length === 1)) {
      ev.preventDefault();
      pick(active >= 0 ? active : 0);
    }
  };
  const onListMousedown = (ev: MouseEvent) => {
    const node = (ev.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!node) return;
    ev.preventDefault();
    pick(Number(node.dataset.index));
  };
  const onDocumentMousedown = (ev: MouseEvent) => {
    const target = ev.target as Node;
    if (target !== input && !list.contains(target)) close();
  };
  const onBlur = () => close();
  input.addEventListener('focus', refresh);
  input.addEventListener('click', refresh);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('blur', onBlur);
  list.addEventListener('mousedown', onListMousedown);
  document.addEventListener('mousedown', onDocumentMousedown);
  const destroy = () => {
    close();
    input.removeEventListener('focus', refresh);
    input.removeEventListener('click', refresh);
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKeydown);
    input.removeEventListener('blur', onBlur);
    list.removeEventListener('mousedown', onListMousedown);
    document.removeEventListener('mousedown', onDocumentMousedown);
    list.remove();
    originalAttributes.forEach(([name, value]) => {
      if (value === null) input.removeAttribute(name);
      else input.setAttribute(name, value);
    });
  };
  return { close, refresh, destroy };
};

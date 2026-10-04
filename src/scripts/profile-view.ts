import { BASE, t } from './search';
import type { MediaKey } from './profile-media';

export type PickerChar = { slug: string; name: string; icon: string; element: string; rarity: number; namecard: string };
export type Avatar = { type: 'none' } | { type: 'character'; slug: string } | { type: 'upload' };
export type CoverType = 'none' | 'namecard' | 'upload';
export type BackgroundType = 'default' | 'namecard' | 'upload' | 'color';
export type Frame = 'none' | 'gold' | 'accent' | 'ice' | 'constellation' | 'flame' | 'petals' | 'abyss';
export type Effect = 'none' | 'snow' | 'sparks' | 'petals' | 'stars' | 'fireflies' | 'blizzard';
export type Custom = { v: 1; nick: string; about: string; avatar: Avatar; media: Partial<Record<MediaKey, string>>; cover: string; coverType: CoverType; coverPosition: number; color: string; favorites: string[]; frame: Frame; effect: Effect; intensity: number; background: { type: BackgroundType; slug: string; darken: number; blur: number; gradient: boolean } };
type MediaSource = (key: MediaKey) => string | null;
type EffectView = ReturnType<typeof createEffect>;

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', label = '') => { const node = document.createElement(tag); node.className = className; node.textContent = label; return node; };
export const iconUrl = (value: unknown) => { if (typeof value !== 'string') return null; try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
export const img = (src: string, size: number) => { const node = document.createElement('img'); node.src = src; node.alt = ''; node.width = size; node.height = size; node.loading = 'lazy'; node.decoding = 'async'; return node; };
export const colors = ['accent', 'pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo'] as const;
export const colorNames = ['Золото сайта', 'Пиро', 'Гидро', 'Анемо', 'Электро', 'Дендро', 'Крио', 'Гео'];
export const extraColors = [
  ['pink', 'Розовый', '#ff6fa8'], ['turquoise', 'Бирюзовый', '#3fd0c9'], ['emerald', 'Изумрудный', '#3ecf7a'],
  ['lavender', 'Лавандовый', '#a78bfa'], ['scarlet', 'Алый', '#ff4d5e'], ['silver', 'Серебро', '#c9d3e3'],
] as const;
export const frames: [Frame, string][] = [['none', 'Без рамки'], ['gold', 'Золото'], ['accent', 'Цвет профиля'], ['ice', 'Лёд'], ['constellation', 'Созвездие'], ['flame', 'Пламя'], ['petals', 'Лепестки'], ['abyss', 'Бездна']];
export const effects: [Effect, string][] = [['none', 'Нет'], ['snow', 'Снегопад'], ['sparks', 'Искры'], ['petals', 'Лепестки'], ['stars', 'Звёздное небо'], ['fireflies', 'Светлячки'], ['blizzard', 'Метель']];
export const elements = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo'];
export const mediaKeys: MediaKey[] = ['avatar', 'cover', 'background'];
export const hexOk = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const colorOk = (value: unknown): value is string => typeof value === 'string' && (hexOk(value) || colors.some((color) => color === value) || extraColors.some(([key]) => key === value));
export const bounded = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
export const emptyCustom = (): Custom => ({ v: 1, nick: '', about: '', avatar: { type: 'none' }, media: {}, cover: '', coverType: 'none', coverPosition: 50, color: 'accent', favorites: [], frame: 'none', effect: 'none', intensity: 50, background: { type: 'default', slug: '', darken: 30, blur: 0, gradient: true } });
export const usesMedia = (custom: Custom, key: MediaKey) => key === 'avatar' ? custom.avatar.type === 'upload' : key === 'cover' ? custom.coverType === 'upload' : custom.background.type === 'upload';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function readPickerChars(node: HTMLElement | null): PickerChar[] {
  const raw: unknown = (() => { try { return JSON.parse(node?.textContent ?? '[]'); } catch { return []; } })();
  return Array.isArray(raw) ? raw.filter((item): item is PickerChar =>
    isRecord(item) && typeof item.slug === 'string' && /^[a-z0-9-]+$/.test(item.slug) && typeof item.name === 'string' &&
    typeof item.icon === 'string' && typeof item.element === 'string' && typeof item.rarity === 'number' && typeof item.namecard === 'string') : [];
}

export function validCustom(value: unknown, pickerBySlug: ReadonlyMap<string, PickerChar>) {
  const result = emptyCustom();
  if (value === null) return { value: result, valid: true };
  if (!isRecord(value) || value.v !== 1) return { value: result, valid: false };
  let valid = true;
  if (typeof value.nick === 'string' && value.nick.length <= 24) result.nick = value.nick; else valid = false;
  if (typeof value.about === 'string' && value.about.length <= 300) result.about = value.about; else valid = false;
  if (value.media !== undefined) {
    if (!isRecord(value.media)) valid = false;
    else for (const key of mediaKeys) {
      const id = value.media[key];
      if (id === undefined) continue;
      if (typeof id === 'string' && /^[a-z0-9-]{1,64}$/i.test(id)) result.media[key] = id;
      else valid = false;
    }
  }
  if (isRecord(value.avatar)) {
    if (value.avatar.type === 'none') result.avatar = { type: 'none' };
    else if (value.avatar.type === 'character' && typeof value.avatar.slug === 'string' && pickerBySlug.has(value.avatar.slug)) result.avatar = { type: 'character', slug: value.avatar.slug };
    else if (value.avatar.type === 'upload' && value.avatar.data === undefined) result.avatar = { type: 'upload' };
    else valid = false;
  } else valid = false;
  if (typeof value.cover === 'string' && (!value.cover || !!pickerBySlug.get(value.cover)?.namecard)) result.cover = value.cover; else valid = false;
  if (value.coverType === undefined) result.coverType = result.cover ? 'namecard' : 'none';
  else if (value.coverType === 'none' || value.coverType === 'upload' || value.coverType === 'namecard') result.coverType = value.coverType;
  else valid = false;
  if (result.coverType === 'namecard' && !result.cover) valid = false;
  if (value.coverPosition === undefined || bounded(value.coverPosition, 0, 100)) result.coverPosition = value.coverPosition as number ?? 50; else valid = false;
  if (colorOk(value.color)) result.color = value.color; else valid = false;
  if (value.frame === undefined || frames.some(([key]) => key === value.frame)) result.frame = value.frame as Frame ?? 'none'; else valid = false;
  if (value.effect === undefined || effects.some(([key]) => key === value.effect)) result.effect = value.effect as Effect ?? 'none'; else valid = false;
  if (value.intensity === undefined || bounded(value.intensity, 25, 100)) result.intensity = value.intensity as number ?? 50; else valid = false;
  if (value.background !== undefined) {
    const bg = value.background;
    if (isRecord(bg) && ['default', 'namecard', 'upload', 'color'].includes(String(bg.type)) &&
      typeof bg.slug === 'string' && (!bg.slug || !!pickerBySlug.get(bg.slug)?.namecard) &&
      bounded(bg.darken, 0, 80) && bounded(bg.blur, 0, 12) && typeof bg.gradient === 'boolean' &&
      (bg.type !== 'namecard' || !!bg.slug)) result.background = bg as Custom['background'];
    else valid = false;
  }
  if (Array.isArray(value.favorites)) {
    const unique = new Set<string>();
    for (const slug of value.favorites) {
      if (typeof slug === 'string' && pickerBySlug.has(slug) && !unique.has(slug) && unique.size < 6) unique.add(slug);
      else valid = false;
    }
    result.favorites = [...unique];
  } else valid = false;
  return { value: result, valid };
}

export function accentHex(color: string) {
  if (hexOk(color)) return color.toLowerCase();
  const extra = extraColors.find(([key]) => key === color);
  if (extra) return extra[2];
  return getComputedStyle(document.documentElement).getPropertyValue(`--${color}`).trim() || '#e3b04b';
}

export function accentInk(hex: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .5 ? '#20212a' : '#ffffff';
}

export function frameMarks(shell: HTMLElement) {
  const decoration = shell.querySelector<HTMLElement>('.frame-decoration');
  if (!decoration || decoration.querySelector('.frame-mark')) return;
  for (let index = 0; index < 8; index++) {
    const mark = el('span', 'frame-mark');
    mark.style.setProperty('--mark-index', String(index));
    decoration.append(mark);
  }
}

export function renderAvatar(box: HTMLElement, shell: HTMLElement, custom: Custom, pickerBySlug: ReadonlyMap<string, PickerChar>, mediaSource: MediaSource, placeholder: Node) {
  box.replaceChildren(placeholder.cloneNode(true));
  const src = custom.avatar.type === 'character' ? iconUrl(pickerBySlug.get(custom.avatar.slug)?.icon) : custom.avatar.type === 'upload' ? mediaSource('avatar') : null;
  if (src) box.replaceChildren(img(src, 96));
  shell.dataset.frame = custom.frame;
  frameMarks(shell);
}

export function renderCover(cover: HTMLImageElement, custom: Custom, pickerBySlug: ReadonlyMap<string, PickerChar>, mediaSource: MediaSource) {
  const src = custom.coverType === 'upload' ? mediaSource('cover') : custom.coverType === 'namecard' ? iconUrl(pickerBySlug.get(custom.cover)?.namecard) : null;
  cover.hidden = !src;
  cover.style.objectPosition = `center ${custom.coverPosition}%`;
  if (src) cover.src = src; else cover.removeAttribute('src');
}

export function renderBackground(layer: HTMLElement, custom: Custom, pickerBySlug: ReadonlyMap<string, PickerChar>, mediaSource: MediaSource) {
  const bg = custom.background;
  const src = bg.type === 'upload' ? mediaSource('background') : bg.type === 'namecard' ? iconUrl(pickerBySlug.get(bg.slug)?.namecard) : null;
  layer.style.backgroundImage = src ? `url("${src}")` : bg.type === 'color' ? bg.gradient ? `linear-gradient(135deg, ${accentHex(custom.color)}, var(--bg-deep))` : 'none' : 'none';
  layer.style.backgroundColor = bg.type === 'color' ? accentHex(custom.color) : 'transparent';
  layer.style.setProperty('--profile-darken', String(bg.darken / 100));
  layer.style.setProperty('--profile-blur', `${bg.blur}px`);
  layer.hidden = bg.type === 'default' || ((bg.type === 'upload' || bg.type === 'namecard') && !src);
  document.documentElement.classList.toggle('profile-custom-bg', !layer.hidden);
}

export function renderFavorites(section: HTMLElement, box: HTMLElement, custom: Custom, pickerBySlug: ReadonlyMap<string, PickerChar>) {
  box.replaceChildren();
  for (const slug of custom.favorites) {
    const char = pickerBySlug.get(slug);
    if (!char) continue;
    const link = document.createElement('a');
    link.href = `${BASE}/characters/${char.slug}/`;
    link.className = `favorite-tile r${char.rarity === 5 ? 5 : 4}`;
    link.setAttribute('data-el', elements.includes(char.element) ? char.element : '');
    const portrait = el('span', 'favorite-portrait');
    const image = iconUrl(char.icon);
    if (image) portrait.append(img(image, 88));
    const name = el('span', 'favorite-name', char.name);
    const element = el('span', 'favorite-element');
    element.setAttribute('aria-label', t(colorNames[colors.indexOf(char.element as typeof colors[number])] ?? 'Персонаж'));
    link.append(portrait, name, element);
    box.append(link);
  }
  section.hidden = !box.childElementCount;
}

export function renderAppearance(root: HTMLElement, custom: Custom, pickerBySlug: ReadonlyMap<string, PickerChar>, mediaSource: MediaSource, fallbackName: string, placeholder: Node, effect: EffectView) {
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const accent = accentHex(custom.color);
  root.style.setProperty('--profile-accent', accent);
  root.style.setProperty('--profile-accent-ink', accentInk(accent));
  $('profile-name').textContent = custom.nick || fallbackName;
  const about = $('profile-about');
  about.textContent = custom.about;
  about.hidden = !custom.about;
  renderCover($<HTMLImageElement>('profile-cover'), custom, pickerBySlug, mediaSource);
  renderAvatar($('profile-avatar'), $('profile-avatar-shell'), custom, pickerBySlug, mediaSource, placeholder);
  renderFavorites($('profile-favorites'), $('profile-favorites-list'), custom, pickerBySlug);
  renderBackground($('profile-bg'), custom, pickerBySlug, mediaSource);
  effect.render();
}

type Particle = { x: number; y: number; vx: number; vy: number; size: number; phase: number; spin: number };

export function createEffect(canvas: HTMLCanvasElement, getCustom: () => Custom, signal: AbortSignal) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let particles: Particle[] = [], effectFrame = 0, effectKey = '', effectLast = 0, resizeTimer = 0;
  function stop() { cancelAnimationFrame(effectFrame); effectFrame = 0; effectKey = ''; particles = []; canvas.hidden = true; }
  function sizeEffect() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(innerWidth * ratio));
    canvas.height = Math.max(1, Math.round((innerHeight - canvas.getBoundingClientRect().top) * ratio));
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${Math.max(1, innerHeight - canvas.getBoundingClientRect().top)}px`;
    canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = Array.from({ length: Math.min(120, Math.round(getCustom().intensity * 1.2)) }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * canvas.clientHeight,
      vx: (Math.random() - .5) * 1.2, vy: .3 + Math.random() * 1.3,
      size: 1 + Math.random() * 3, phase: Math.random() * Math.PI * 2, spin: (Math.random() - .5) * .04,
    }));
  }
  function tickEffect(time: number) {
    effectFrame = 0;
    if (document.hidden || reduced.matches || getCustom().effect === 'none' || canvas.hidden) return;
    const context = canvas.getContext('2d');
    if (!context) { stop(); return; }
    const step = Math.min((time - (effectLast || time)) / 16.7, 2);
    effectLast = time;
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const height = canvas.clientHeight, width = canvas.clientWidth, color = accentHex(getCustom().color);
    for (const particle of particles) {
      const effect = getCustom().effect;
      const wind = effect === 'blizzard' ? 5 : effect === 'petals' ? .7 : 0;
      particle.x += (particle.vx + wind) * step;
      particle.y += (effect === 'stars' ? 0 : effect === 'fireflies' ? Math.sin(time / 700 + particle.phase) * .25 : particle.vy * (effect === 'blizzard' ? 3 : 1)) * step;
      particle.phase += particle.spin * step;
      if (particle.x > width + 20) particle.x = -20;
      if (particle.x < -20) particle.x = width + 20;
      if (particle.y > height + 20) particle.y = -20;
      context.save();
      context.translate(particle.x, particle.y);
      context.globalAlpha = .35 + (Math.sin(time / 600 + particle.phase * 8) + 1) * .3;
      context.fillStyle = effect === 'snow' || effect === 'blizzard' || effect === 'stars' ? '#ffffff' : effect === 'sparks' ? (particle.size > 2.5 ? '#ffd878' : color) : color;
      if (effect === 'petals') {
        context.rotate(particle.phase);
        context.beginPath(); context.ellipse(0, 0, particle.size * 1.7, particle.size * .8, 0, 0, Math.PI * 2); context.fill();
      } else if (effect === 'blizzard') {
        context.rotate(-.6);
        context.fillRect(0, 0, particle.size * 4, Math.max(1, particle.size / 2));
      } else {
        if (effect === 'fireflies' || effect === 'sparks') { context.shadowBlur = 12; context.shadowColor = context.fillStyle; }
        context.beginPath(); context.arc(0, 0, effect === 'stars' ? particle.size * .6 : particle.size, 0, Math.PI * 2); context.fill();
      }
      context.restore();
    }
    effectFrame = requestAnimationFrame(tickEffect);
  }
  function render() {
    if (getCustom().effect === 'none' || reduced.matches || !canvas.getContext('2d')) { stop(); return; }
    const key = `${getCustom().effect}:${getCustom().intensity}`;
    if (key !== effectKey) { effectKey = key; canvas.hidden = false; sizeEffect(); effectLast = 0; }
    if (!document.hidden && !effectFrame) effectFrame = requestAnimationFrame(tickEffect);
  }
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => { if (!canvas.hidden) sizeEffect(); }, 120); }, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(effectFrame); effectFrame = 0; } else render(); }, { signal });
  reduced.addEventListener('change', render, { signal });
  signal.addEventListener('abort', () => { stop(); clearTimeout(resizeTimer); }, { once: true });
  return { render, stop, reduced };
}

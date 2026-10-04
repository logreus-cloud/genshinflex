import { BASE, t } from './search';
import type { MediaKey } from './profile-media';
import type { Entry } from './common';

export type PickerChar = { slug: string; name: string; icon: string; element: string; rarity: number; namecard: string };
export type Char = { id: number | null; s: string; n: string; i: string };
export type RosterEntry = Record<string, unknown> & { s: string };
export type Profile = { uid: string; time: number; player: { nickname: string; level: number; worldLevel: number; signature: string; profilePictureId?: number }; showcase: number[] };
export type WishSummary = { label: string; total: number; fives: number; pity: { character: number; weapon: number; standard: number }; recent?: { name: string; gacha_type: string; time: string }[] };
export type Avatar = { type: 'none' } | { type: 'character'; slug: string } | { type: 'upload' };
export type CoverType = 'none' | 'namecard' | 'upload';
export type BackgroundType = 'default' | 'namecard' | 'upload' | 'color';
export type Frame = 'none' | 'gold' | 'accent' | 'ice' | 'constellation' | 'flame' | 'petals' | 'abyss';
export type Effect = 'none' | 'snow' | 'sparks' | 'petals' | 'stars' | 'fireflies' | 'blizzard';
export type Framing = { x: number; y: number; zoom: number };
export type Custom = { v: 1; nick: string; about: string; avatar: Avatar; media: Partial<Record<MediaKey, string>>; framing: Partial<Record<MediaKey, Framing>>; cover: string; coverType: CoverType; coverPosition: number; color: string; favorites: string[]; frame: Frame; effect: Effect; intensity: number; background: { type: BackgroundType; slug: string; darken: number; blur: number; gradient: boolean } };
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
export const emptyCustom = (): Custom => ({ v: 1, nick: '', about: '', avatar: { type: 'none' }, media: {}, framing: {}, cover: '', coverType: 'none', coverPosition: 50, color: 'accent', favorites: [], frame: 'none', effect: 'none', intensity: 50, background: { type: 'default', slug: '', darken: 30, blur: 0, gradient: true } });
export const framingOf = (custom: Custom, key: MediaKey): Framing => custom.framing[key] ?? { x: 50, y: key === 'cover' && custom.coverType === 'upload' ? custom.coverPosition : 50, zoom: 100 };
export const usesMedia = (custom: Custom, key: MediaKey) => key === 'avatar' ? custom.avatar.type === 'upload' : key === 'cover' ? custom.coverType === 'upload' : custom.background.type === 'upload';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
export const safeHref = (value: string) => { if (!value.startsWith('/') || value.startsWith('//')) return null; try { const url = new URL(value, location.origin); const path = url.pathname; return url.origin === location.origin && !/^\/[\\/]/.test(path) ? path + url.search + url.hash : null; } catch { return null; } };

// Для показа можно проверить каталог; при импорте сохраняем незнакомые slug
export function validRoster(value: unknown, known?: ReadonlyMap<string, unknown>) {
  if (!Array.isArray(value)) return null;
  const list: RosterEntry[] = [];
  let valid = true;
  for (const item of value) {
    if (!isRecord(item) || typeof item.s !== 'string' || (known && !known.has(item.s))) { valid = false; continue; }
    list.push({ ...item, s: item.s });
  }
  return { value: list, valid };
}

export async function loadChars(signal: AbortSignal) {
  const response = await fetch(`${BASE}/data/checker.json`, { signal });
  if (!response.ok) throw new Error();
  const data: unknown = await response.json();
  if (signal.aborted || !isRecord(data) || !Array.isArray(data.characters)) throw new Error();
  const byId = new Map<number, Char>(), bySlug = new Map<string, Char>();
  for (const value of data.characters) if (isRecord(value) && typeof value.id === 'number' && typeof value.s === 'string' &&
    /^[a-z0-9-]+$/.test(value.s) && typeof value.n === 'string' && typeof value.i === 'string') {
    const char = value as Char; byId.set(char.id!, char); bySlug.set(char.s, char);
  }
  return { byId, bySlug };
}

function addChar(parent: HTMLElement, char: Char) {
  const link = document.createElement('a');
  link.href = `${BASE}/characters/${char.s}/`;
  link.title = char.n;
  const src = iconUrl(char.i);
  if (src) link.append(img(src, 56));
  link.append(el('span', '', char.n));
  parent.append(link);
}

export function readPickerChars(node: HTMLElement | null): PickerChar[] {
  const raw: unknown = (() => { try { return JSON.parse(node?.textContent ?? '[]'); } catch { return []; } })();
  return Array.isArray(raw) ? raw.filter((item): item is PickerChar =>
    isRecord(item) && typeof item.slug === 'string' && /^[a-z0-9-]+$/.test(item.slug) && typeof item.name === 'string' &&
    typeof item.icon === 'string' && typeof item.element === 'string' && typeof item.rarity === 'number' && typeof item.namecard === 'string') : [];
}

export function renderEntryList(box: HTMLElement, list: Entry[], empty: string, hideEmpty = false) {
  box.replaceChildren();
  box.closest('section')!.hidden = hideEmpty && !list.length;
  if (!list.length) { if (!hideEmpty) box.append(el('span', 'empty', t(empty))); return; }
  for (const item of list.slice(0, 100)) {
    if (!item || typeof item.href !== 'string' || typeof item.name !== 'string') continue;
    const href = safeHref(item.href);
    if (!href) continue;
    const link = document.createElement('a');
    link.href = href;
    const src = iconUrl(item.icon);
    if (src) link.append(img(src, 40));
    link.append(el('span', '', item.name));
    box.append(link);
  }
  if (!box.childElementCount && !hideEmpty) box.append(el('span', 'empty', t(empty)));
  if (hideEmpty && !box.childElementCount) box.closest('section')!.hidden = true;
}

export function renderRosterList(box: HTMLElement, countEl: HTMLElement, list: RosterEntry[], bySlug: ReadonlyMap<string, Char>) {
  box.replaceChildren();
  const seen = new Set<string>();
  const known = list.filter((item) => bySlug.has(item.s) && !seen.has(item.s) && !!seen.add(item.s));
  countEl.textContent = known.length ? t('Персонажей: {n}', { n: known.length }) : '';
  if (!known.length) { box.textContent = t('Добавьте персонажей в проверке команды или загрузите по UID.'); return; }
  for (const item of known.slice(0, 16)) addChar(box, bySlug.get(item.s)!);
  if (known.length > 16) box.append(el('span', 'more', `+${known.length - 16}`));
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
  if (value.framing !== undefined) {
    if (!isRecord(value.framing)) valid = false;
    else for (const [key, frame] of Object.entries(value.framing)) {
      if (!mediaKeys.includes(key as MediaKey) || !isRecord(frame) ||
        !bounded(frame.x, 0, 100) || !bounded(frame.y, 0, 100) || !bounded(frame.zoom, 100, 400)) {
        valid = false;
        continue;
      }
      result.framing[key as MediaKey] = { x: frame.x as number, y: frame.y as number, zoom: frame.zoom as number };
    }
  }
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

export function renderWishSummary(box: HTMLElement, accounts: WishSummary[]) {
  box.replaceChildren();
  for (const summary of accounts) {
    const account = el('div', 'account');
    account.append(el('h3', '', summary.label), el('p', 'summary', t('Молитв: {total} · 5★: {fives}', { total: summary.total, fives: summary.fives })));
    for (const [title, pity] of [
      [t('Молитва события персонажа'), summary.pity.character], [t('Молитва события оружия'), summary.pity.weapon],
      [t('Стандартная молитва'), summary.pity.standard],
    ] as [string, number][]) {
      const line = el('div', 'pity-row');
      line.append(el('span', '', title), el('span', '', t('Текущий гарант: {n}', { n: pity })));
      account.append(line);
    }
    if (summary.recent?.length) {
      const recent = el('p', 'recent', t('Последние 5★: '));
      for (const [index, wish] of summary.recent.slice(0, 10).entries()) {
        if (index) recent.append(document.createTextNode(', '));
        const name = el('span', '', wish.name);
        name.title = wish.time;
        recent.append(name);
      }
      account.append(recent);
    }
    box.append(account);
  }
  if (!box.childElementCount) box.append(el('p', 'empty', t('История круток не загружена')));
}

export function accentHex(color: string) {
  if (hexOk(color)) return color.toLowerCase();
  const extra = extraColors.find(([key]) => key === color);
  if (extra) return extra[2];
  return getComputedStyle(document.documentElement).getPropertyValue(`--${color}`).trim() || '#e3b04b';
}

export async function fetchShowcase(uid: string, signal: AbortSignal): Promise<Profile> {
  const response = await fetch(`/api/enka/${uid}`, { signal });
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Не удалось загрузить профиль.'); }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!response.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : 'Не удалось загрузить профиль.');
  if (!isRecord(body) || !isRecord(body.playerInfo)) throw new Error('Не удалось загрузить профиль.');
  const player = body.playerInfo;
  const picture = isRecord(player.profilePicture) ? num(player.profilePicture.avatarId ?? player.profilePicture.id) : null;
  const shown = Array.isArray(player.showAvatarInfoList) && player.showAvatarInfoList.length ? player.showAvatarInfoList : body.avatarInfoList;
  const showcase = Array.isArray(shown) ? shown.map((item) => isRecord(item) ? num(item.avatarId) : null).filter((id): id is number => id !== null) : [];
  return { uid, time: Date.now(), player: { nickname: typeof player.nickname === 'string' ? player.nickname : '', level: num(player.level) ?? 0,
    worldLevel: num(player.worldLevel) ?? 0, signature: typeof player.signature === 'string' ? player.signature : '', profilePictureId: picture ?? undefined }, showcase };
}

export function accentInk(hex: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .5 ? '#20212a' : '#ffffff';
}

export function renderShowcase(box: HTMLElement, meta: HTMLElement, profile: Profile, byId: ReadonlyMap<number, Char>) {
  meta.textContent = t('Ранг приключений {level} · Уровень мира {world}', { level: profile.player.level, world: profile.player.worldLevel });
  meta.hidden = false;
  box.replaceChildren();
  for (const id of profile.showcase) { const char = byId.get(id); if (char) addChar(box, char); }
  if (!box.childElementCount) box.textContent = profile.showcase.length ? t('На витрине нет знакомых персонажей.') : t('Витрина пуста или скрыта.');
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

export function applyFraming(image: HTMLImageElement, frame: Framing | null) {
  image.style.objectFit = 'cover';
  image.style.objectPosition = frame ? `${frame.x}% ${frame.y}%` : '';
  image.style.transform = frame ? `scale(${frame.zoom / 100})` : '';
  image.style.transformOrigin = frame ? `${frame.x}% ${frame.y}%` : '';
}

export function renderAvatar(box: HTMLElement, shell: HTMLElement, custom: Custom, pickerBySlug: ReadonlyMap<string, PickerChar>, mediaSource: MediaSource, placeholder: Node) {
  box.replaceChildren(placeholder.cloneNode(true));
  const src = custom.avatar.type === 'character' ? iconUrl(pickerBySlug.get(custom.avatar.slug)?.icon) : custom.avatar.type === 'upload' ? mediaSource('avatar') : null;
  if (src) {
    const image = img(src, 96);
    applyFraming(image, custom.avatar.type === 'upload' ? framingOf(custom, 'avatar') : null);
    box.replaceChildren(image);
  }
  shell.dataset.frame = custom.frame;
  frameMarks(shell);
}

export function renderCover(cover: HTMLImageElement, custom: Custom, pickerBySlug: ReadonlyMap<string, PickerChar>, mediaSource: MediaSource) {
  const src = custom.coverType === 'upload' ? mediaSource('cover') : custom.coverType === 'namecard' ? iconUrl(pickerBySlug.get(custom.cover)?.namecard) : null;
  cover.hidden = !src;
  applyFraming(cover, custom.coverType === 'upload' ? framingOf(custom, 'cover') : null);
  if (custom.coverType === 'namecard') cover.style.objectPosition = `center ${custom.coverPosition}%`;
  if (src) cover.src = src; else cover.removeAttribute('src');
}

export function renderBackground(layer: HTMLElement, custom: Custom, pickerBySlug: ReadonlyMap<string, PickerChar>, mediaSource: MediaSource) {
  const bg = custom.background;
  const src = bg.type === 'upload' ? mediaSource('background') : bg.type === 'namecard' ? iconUrl(pickerBySlug.get(bg.slug)?.namecard) : null;
  const image = layer.querySelector<HTMLElement>('.profile-bg-image')!;
  const frame = bg.type === 'upload' ? framingOf(custom, 'background') : null;
  image.style.backgroundImage = src ? `url("${src}")` : bg.type === 'color' ? bg.gradient ? `linear-gradient(135deg, ${accentHex(custom.color)}, var(--bg-deep))` : 'none' : 'none';
  image.style.backgroundColor = bg.type === 'color' ? accentHex(custom.color) : 'transparent';
  image.style.backgroundPosition = frame ? `${frame.x}% ${frame.y}%` : '';
  image.style.transform = frame ? `scale(${frame.zoom / 100})` : '';
  image.style.transformOrigin = frame ? `${frame.x}% ${frame.y}%` : '';
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

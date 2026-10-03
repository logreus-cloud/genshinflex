import '../scripts/common';
import '../scripts/build-guard';
import { onPage, cleanup } from '../scripts/router';
onPage((signal) => {
  const side = document.getElementById('side');
  if (!side) return;
  const root = document.documentElement;
  document.getElementById('theme')?.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('gf:theme', root.dataset.theme); } catch {}
  }, { signal });
  const scrim = document.getElementById('scrim')!, burger = document.getElementById('burger')!;
  const shell = document.querySelector<HTMLElement>('.shell')!;
  const searchPanel = document.getElementById('search-panel')!;
  const searchButtons = [document.getElementById('search-pill')!, document.getElementById('search-icon')!];
  const languageButton = document.getElementById('language-button')!;
  const languageMenu = document.getElementById('language-menu')!;
  const openMenuLabel = burger.getAttribute('aria-label')!;
  const closeMenuLabel = burger.dataset.closeLabel!;
  let searchTrigger = searchButtons[0];
  const closeSearch = (restore = false) => {
    if (searchPanel.hidden) return;
    searchPanel.hidden = true;
    searchButtons.forEach((button) => button.setAttribute('aria-expanded', 'false'));
    if (restore) searchTrigger.focus({ preventScroll: true });
  };
  const closeLanguage = (restore = false) => {
    if (languageMenu.hidden) return;
    languageMenu.hidden = true;
    languageButton.setAttribute('aria-expanded', 'false');
    if (restore) languageButton.focus({ preventScroll: true });
  };
  const toggle = (open: boolean, restore = false) => {
    if (open) { closeSearch(); closeLanguage(); }
    if (!open) shell.inert = false;
    side.classList.toggle('open', open);
    side.inert = !open;
    side.setAttribute('aria-hidden', String(!open));
    scrim.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? closeMenuLabel : openMenuLabel);
    if (open) {
      shell.inert = true;
      side.querySelector<HTMLElement>('.side-close')?.focus({ preventScroll: true });
    }
    else if (restore) burger.focus({ preventScroll: true });
  };
  cleanup(signal, () => {
    closeSearch();
    closeLanguage();
    toggle(false);
  });
  burger.addEventListener('click', () => toggle(!side.classList.contains('open')), { signal });
  side.querySelector('.side-close')?.addEventListener('click', () => toggle(false, true), { signal });
  scrim.addEventListener('click', () => toggle(false, true), { signal });
  searchButtons.forEach((button) => button.addEventListener('click', () => {
    const open = searchPanel.hidden;
    closeLanguage();
    if (open) {
      searchTrigger = button;
      searchPanel.hidden = false;
      searchButtons.forEach((item) => item.setAttribute('aria-expanded', 'true'));
      searchPanel.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    } else closeSearch(true);
  }, { signal }));
  languageButton.addEventListener('click', () => {
    const open = languageMenu.hidden;
    closeSearch();
    languageMenu.hidden = !open;
    languageButton.setAttribute('aria-expanded', String(open));
    if (open) languageMenu.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true });
  }, { signal });
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node;
    if (!searchPanel.contains(target) && !searchButtons.some((button) => button.contains(target))) closeSearch();
    if (!languageMenu.contains(target) && !languageButton.contains(target)) closeLanguage();
  }, { signal });
  document.addEventListener('keydown', (e) => {
    if (!side.classList.contains('open')) return;
    if (e.key === '/') { e.preventDefault(); e.stopPropagation(); }
    if (e.key !== 'Tab') return;
    const items = [...side.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && (document.activeElement === first || !side.contains(document.activeElement))) {
      e.preventDefault();
      last?.focus({ preventScroll: true });
    } else if (!e.shiftKey && (document.activeElement === last || !side.contains(document.activeElement))) {
      e.preventDefault();
      first?.focus({ preventScroll: true });
    }
  }, { capture: true, signal });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (side.classList.contains('open')) toggle(false, true);
      else if (!searchPanel.hidden) closeSearch(true);
      else closeLanguage(true);
    }
  }, { signal });
});

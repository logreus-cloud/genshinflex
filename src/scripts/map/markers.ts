import * as L from 'leaflet';
import { t } from '../search';
import { pageBase } from '../auth';
import type { CollectedStore } from './collected';
import { mapErrorText, mapRpc } from './api';

export const MARKER_TYPES = [
  { id: 'waypoint', label: 'Точки телепорта', color: '#4d9fe6', glyph: 'M12 2 21 12 12 22 3 12Z' },
  { id: 'statue', label: 'Статуи Семи', color: '#49bcb1', glyph: 'M12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9Z' },
  { id: 'domain', label: 'Подземелья', color: '#9673d5', glyph: 'M4 21V10a8 8 0 0 1 16 0v11M8 21V11a4 4 0 0 1 8 0v10' },
  { id: 'boss', label: 'Боссы', color: '#d56b6b', glyph: 'M3 8 7 12 12 5 17 12 21 8 19 20H5Z' },
  { id: 'oculus', label: 'Окулусы', color: '#56acc7', glyph: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6' },
  { id: 'chest', label: 'Сундуки', color: '#c99a45', glyph: 'M3 9h18v12H3zM3 9l3-5h12l3 5M12 9v12' },
  { id: 'specialty', label: 'Местные диковинки', color: '#79ad62', glyph: 'M12 4c2 4 4 6 8 8-4 2-6 4-8 8-2-4-4-6-8-8 4-2 6-4 8-8Z' },
  { id: 'puzzle', label: 'Головоломки', color: '#db8a53', glyph: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'other', label: 'Другое', color: '#8793a3', glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v5M12 17h.01' },
] as const;
export type MarkerTypeId = (typeof MARKER_TYPES)[number]['id'];
export type MapMarker = { id: number; type: string; x: number; y: number; item: string | null; title: string | null; note: string | null; status: 'approved' | 'pending' };
export type MapRole = { userId: string | null; moderator: boolean };

const FILTER_KEY = 'gf:map.filters';
const HIDE_KEY = 'gf:map.hideCollected';
const KNOWN_TYPES = new Set<MarkerTypeId>(MARKER_TYPES.map(type => type.id));
const DENSE_TYPES = new Set<MarkerTypeId>(['chest', 'specialty', 'oculus']);

function savedFilters(): Set<MarkerTypeId> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
    if (Array.isArray(stored)) return new Set(stored.filter((id): id is MarkerTypeId =>
      typeof id === 'string' && KNOWN_TYPES.has(id as MarkerTypeId)));
  } catch {}
  return new Set(MARKER_TYPES.map(type => type.id));
}
function saveFilters(selected: Set<MarkerTypeId>) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify([...selected])); } catch {}
}

export async function loadMarkers(layer: string): Promise<MapMarker[] | null> {
  try {
    const { getSupabase } = await import('../auth');
    const markers: MapMarker[] = [];
    while (markers.length < 20000) {
      const { data, error } = await getSupabase().from('map_markers')
        .select('id,type,x,y,item,title,note,status')
        .eq('layer', layer).in('status', ['approved', 'pending'])
        .gt('id', markers.at(-1)?.id ?? 0)
        .order('id', { ascending: true })
        .limit(1000);
      if (error) throw error;
      const page = (data ?? []) as MapMarker[];
      markers.push(...page);
      if (page.length < 1000) break;
    }
    return markers;
  } catch (error) {
    console.warn('Map markers could not be loaded', error);
    return null;
  }
}

function markerIcon(type: (typeof MARKER_TYPES)[number], compact: boolean, collected: boolean, pending = false) {
  const size = compact ? 18 : 22;
  return L.divIcon({
    className: `gf-marker gf-marker--${type.id}${compact ? ' gf-marker--compact' : ''}${collected ? ' gf-marker--collected' : ''}${pending ? ' gf-marker--pending' : ''}`,
    html: `<span class="gf-marker__badge" style="background:${type.color}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${type.glyph}"/></svg></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}
function markerPopup(type: (typeof MARKER_TYPES)[number], marker: MapMarker, collected: CollectedStore,
  buttons: Map<number, HTMLButtonElement>, role: MapRole, active: () => boolean, changed: () => void, remove: () => void) {
  const popup = document.createElement('div');
  popup.className = 'gf-marker-popup';
  const heading = document.createElement('strong');
  heading.textContent = t(type.label);
  popup.append(heading);
  for (const text of [marker.title, marker.note]) {
    if (!text) continue;
    const line = document.createElement('p');
    line.textContent = text;
    popup.append(line);
  }
  if (marker.status === 'pending') {
    const line = document.createElement('p');
    line.textContent = t('На проверке');
    popup.append(line);
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gf-marker-popup__button';
    button.textContent = t(collected.has(marker.id) ? 'Собрано — снять отметку' : 'Отметить собранным');
    button.disabled = collected.isPending(marker.id);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await collected.toggle(marker.id); }
      finally {
        if (active()) {
          button.disabled = collected.isPending(marker.id);
          button.textContent = t(collected.has(marker.id) ? 'Собрано — снять отметку' : 'Отметить собранным');
        }
      }
    });
    buttons.set(marker.id, button);
    popup.append(button);
  }
  const error = document.createElement('p');
  error.className = 'gf-marker-popup__error';
  const action = (label: string, work: () => Promise<unknown>, done: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gf-marker-popup__button';
    button.textContent = t(label);
    button.addEventListener('click', async () => {
      for (const control of popup.querySelectorAll<HTMLButtonElement>('button')) control.disabled = true;
      error.textContent = '';
      try {
        await work();
        if (active()) done();
      }
      catch (cause) {
        if (!active()) return;
        error.textContent = mapErrorText(cause);
        for (const control of popup.querySelectorAll<HTMLButtonElement>('button')) control.disabled = false;
      }
    });
    popup.append(button);
  };
  if (marker.status === 'pending' && role.userId && !role.moderator) {
    action('Отозвать', () => mapRpc<void>('map_withdraw_marker', { p_id: marker.id }), remove);
  }
  if (role.moderator) {
    if (marker.status === 'pending') {
      action('Одобрить', () => mapRpc<void>('map_review_marker', { p_id: marker.id, p_status: 'approved' }), () => {
        marker.status = 'approved';
        changed();
      });
      action('Отклонить', () => mapRpc<void>('map_review_marker', { p_id: marker.id, p_status: 'rejected' }), remove);
    }
    let confirmed = false;
    const deletion = document.createElement('button');
    deletion.type = 'button';
    deletion.className = 'gf-marker-popup__button';
    deletion.textContent = t('Удалить метку');
    deletion.addEventListener('click', async () => {
      if (!confirmed) {
        confirmed = true;
        deletion.textContent = t('Точно удалить?');
        return;
      }
      for (const control of popup.querySelectorAll<HTMLButtonElement>('button')) control.disabled = true;
      error.textContent = '';
      try {
        await mapRpc<void>('map_delete_marker', { p_id: marker.id });
        if (active()) remove();
      }
      catch (cause) {
        if (!active()) return;
        error.textContent = mapErrorText(cause);
        for (const control of popup.querySelectorAll<HTMLButtonElement>('button')) control.disabled = false;
      }
    });
    popup.append(deletion);
  }
  popup.append(error);
  return popup;
}

export function markerLayer(map: L.Map, markers: MapMarker[], options: {
  compact?: boolean; collected: CollectedStore; role: MapRole; bounds: L.LatLngBounds;
}): { destroy(): void; add(marker: MapMarker): void; open(id: number): boolean } {
  let destroyed = false;
  let hideCollected = false;
  try { hideCollected = localStorage.getItem(HIDE_KEY) === 'true'; } catch {}
  const groups = new Map<MarkerTypeId, L.LayerGroup>();
  const counts = new Map<MarkerTypeId, number>();
  const icons = new Map<MarkerTypeId, { normal: L.DivIcon; collected: L.DivIcon; pending: L.DivIcon }>();
  const pins: { marker: MapMarker; type: MarkerTypeId; pin: L.Marker }[] = [];
  const popupButtons = new Map<number, HTMLButtonElement>();
  const countLabels = new Map<MarkerTypeId, HTMLElement>();
  for (const type of MARKER_TYPES) {
    groups.set(type.id, L.layerGroup());
    counts.set(type.id, 0);
    icons.set(type.id, {
      normal: markerIcon(type, !!options.compact, false),
      collected: markerIcon(type, !!options.compact, true),
      pending: markerIcon(type, !!options.compact, false, true),
    });
  }
  const syncCounts = () => {
    for (const type of MARKER_TYPES) {
      const count = markers.filter(marker => marker.type === type.id && marker.status === 'approved').length;
      counts.set(type.id, count);
      const label = countLabels.get(type.id);
      if (label) {
        label.textContent = String(count);
        label.parentElement?.classList.toggle('gf-map-filters__row--empty', !count);
      }
    }
  };
  const removePin = (marker: MapMarker) => {
    const index = pins.findIndex(item => item.marker.id === marker.id);
    if (index < 0) return;
    const [{ type, pin }] = pins.splice(index, 1);
    groups.get(type)!.removeLayer(pin);
    pin.closePopup();
    popupButtons.delete(marker.id);
    const markerIndex = markers.findIndex(item => item.id === marker.id);
    if (markerIndex >= 0) markers.splice(markerIndex, 1);
    syncCounts();
    syncCollected();
    update();
  };
  const addPin = (marker: MapMarker) => {
    const type = MARKER_TYPES.find(type => type.id === marker.type);
    if (!type) return;
    const pin = L.marker([-marker.y, marker.x], { icon: icons.get(type.id)![marker.status === 'pending' ? 'pending' : 'normal'] });
    pin.bindPopup(() => markerPopup(type, marker, options.collected, popupButtons, options.role, () => !destroyed, () => {
      pin.closePopup();
      syncCounts();
      syncCollected();
      pin.openPopup();
    }, () => removePin(marker)));
    groups.get(type.id)!.addLayer(pin);
    pins.push({ marker, type: type.id, pin });
  };
  for (const marker of markers) addPin(marker);
  syncCounts();

  const selected = savedFilters();
  let progress: HTMLElement | undefined;
  const syncCollected = () => {
    for (const { marker, type, pin } of pins) {
      const marked = marker.status === 'approved' && options.collected.has(marker.id);
      const icon = icons.get(type)![marker.status === 'pending' ? 'pending' : marked ? 'collected' : 'normal'];
      if (pin.options.icon !== icon) pin.setIcon(icon);
      const group = groups.get(type)!;
      if (hideCollected && marked && group.hasLayer(pin)) group.removeLayer(pin);
      if ((!hideCollected || !marked) && !group.hasLayer(pin)) group.addLayer(pin);
      const button = popupButtons.get(marker.id);
      if (button) {
        button.textContent = t(marked ? 'Собрано — снять отметку' : 'Отметить собранным');
        button.disabled = options.collected.isPending(marker.id);
      }
    }
    if (progress) progress.textContent = t('Собрано: {n} из {total}', {
      n: markers.filter(marker => marker.status === 'approved' && options.collected.has(marker.id)).length,
      total: markers.filter(marker => marker.status === 'approved').length,
    });
  };
  const update = () => {
    const bounds = map.getBounds();
    let visible = 0;
    if (map.getZoom() < -2) for (const marker of markers) {
      // выключенные типы не должны прятать включённые
      if (selected.has(marker.type as MarkerTypeId) && marker.x >= bounds.getWest() && marker.x <= bounds.getEast()
        && -marker.y >= bounds.getSouth() && -marker.y <= bounds.getNorth()) visible++;
    }
    const dense = map.getZoom() < -2 && visible > 1500;
    for (const type of MARKER_TYPES) {
      const group = groups.get(type.id)!;
      const show = selected.has(type.id) && !(dense && DENSE_TYPES.has(type.id));
      if (show && !map.hasLayer(group)) group.addTo(map);
      if (!show && map.hasLayer(group)) map.removeLayer(group);
    }
  };

  let filterPanel: HTMLElement | undefined;
  // панель не должна вылезать за карту: ограничиваем высотой контейнера, а не окна
  const fitPanel = () => {
    if (filterPanel) filterPanel.style.maxHeight = `${Math.max(120, map.getSize().y - (options.compact ? 64 : 24))}px`;
  };
  let proposing = false;
  let proposeButton: HTMLButtonElement | undefined;
  let notice: HTMLElement | undefined;
  let formPopup: L.Popup | undefined;
  const setProposing = (active: boolean) => {
    if (destroyed) return;
    proposing = active;
    map.getContainer().classList.toggle('gf-map--proposing', active);
    proposeButton?.classList.toggle('gf-map-filters__action--active', active);
    if (notice) notice.textContent = active ? t('Нажмите на место на карте') : '';
    if (!active && formPopup) map.closePopup(formPopup);
  };
  const proposeClick = (event: L.LeafletMouseEvent) => {
    if (!proposing) return;
    if (!options.bounds.contains(event.latlng)) {
      if (notice) notice.textContent = t('Здесь нет карты');
      return;
    }
    const x = Math.round(event.latlng.lng);
    const y = Math.round(-event.latlng.lat);
    const form = document.createElement('form');
    form.className = 'gf-map-suggest';
    const heading = document.createElement('strong');
    heading.textContent = t('Предложить метку');
    const typeLabel = document.createElement('label');
    typeLabel.textContent = t('Тип метки');
    const typeInput = document.createElement('select');
    for (const type of MARKER_TYPES) {
      const option = document.createElement('option');
      option.value = type.id;
      option.textContent = t(type.label);
      typeInput.append(option);
    }
    typeLabel.append(typeInput);
    const titleLabel = document.createElement('label');
    titleLabel.textContent = t('Название');
    const titleInput = document.createElement('input');
    titleInput.maxLength = 80;
    titleLabel.append(titleInput);
    const noteLabel = document.createElement('label');
    noteLabel.textContent = t('Заметка (необязательно)');
    const noteInput = document.createElement('textarea');
    noteInput.maxLength = 500;
    noteLabel.append(noteInput);
    const status = document.createElement('p');
    status.className = 'gf-map-suggest__status';
    const actions = document.createElement('div');
    actions.className = 'gf-map-suggest__actions';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = t('Отправить');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('Отмена');
    cancel.addEventListener('click', () => setProposing(false));
    actions.append(submit, cancel);
    form.append(heading, typeLabel, titleLabel, noteLabel, status, actions);
    const popup = L.popup().setLatLng(event.latlng).setContent(form);
    form.addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();
      const suggestion = {
        p_layer: 'surface', p_type: typeInput.value, p_x: x, p_y: y,
        p_title: titleInput.value, p_note: noteInput.value,
      };
      submit.disabled = cancel.disabled = true;
      typeInput.disabled = titleInput.disabled = noteInput.disabled = true;
      status.textContent = '';
      try {
        const id = await mapRpc<number>('map_suggest_marker', suggestion);
        if (destroyed) return;
        const marker: MapMarker = {
          id, type: suggestion.p_type, x, y, item: null,
          title: suggestion.p_title.trim() || null, note: suggestion.p_note.trim() || null,
          status: 'pending',
        };
        markers.push(marker);
        addPin(marker);
        syncCounts();
        syncCollected();
        update();
        empty?.remove();
        if (formPopup === popup) {
          setProposing(false);
          if (notice) notice.textContent = t('Метка отправлена на проверку');
        }
      } catch (cause) {
        if (destroyed) return;
        status.textContent = mapErrorText(cause);
        submit.disabled = cancel.disabled = false;
        typeInput.disabled = titleInput.disabled = noteInput.disabled = false;
      }
    });
    formPopup = popup;
    popup.openOn(map);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && proposing) setProposing(false);
  };
  const control = new L.Control({ position: 'topleft' });
  control.onAdd = () => {
    const root = L.DomUtil.create('div', `gf-map-filters${options.compact ? ' gf-map-filters--compact' : ''}`);
    L.DomEvent.disableClickPropagation(root);
    L.DomEvent.disableScrollPropagation(root);
    const panel = document.createElement('div');
    panel.className = 'gf-map-filters__panel';
    filterPanel = panel;
    if (options.compact) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'gf-map-filters__toggle';
      toggle.textContent = '☷';
      toggle.setAttribute('aria-label', t('Метки на карте'));
      toggle.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
      toggle.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
      });
      root.append(toggle);
    }
    const heading = document.createElement('strong');
    heading.className = 'gf-map-filters__heading';
    heading.textContent = t('Метки на карте');
    panel.append(heading);
    const inputs = new Map<MarkerTypeId, HTMLInputElement>();
    syncFilters = () => {
      for (const [id, input] of inputs) input.checked = selected.has(id);
      saveFilters(selected);
      update();
    };
    for (const type of MARKER_TYPES) {
      const row = document.createElement('label');
      row.className = `gf-map-filters__row${counts.get(type.id) ? '' : ' gf-map-filters__row--empty'}`;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = selected.has(type.id);
      input.addEventListener('change', () => {
        if (input.checked) selected.add(type.id);
        else selected.delete(type.id);
        syncFilters();
      });
      inputs.set(type.id, input);
      const swatch = document.createElement('span');
      swatch.className = 'gf-map-filters__swatch';
      swatch.style.backgroundColor = type.color;
      const name = document.createElement('span');
      name.textContent = t(type.label);
      const count = document.createElement('span');
      count.className = 'gf-map-filters__count';
      count.textContent = String(counts.get(type.id));
      countLabels.set(type.id, count);
      row.append(input, swatch, name, count);
      panel.append(row);
    }
    const hideRow = document.createElement('label');
    hideRow.className = 'gf-map-filters__row gf-map-filters__hide';
    const hideInput = document.createElement('input');
    hideInput.type = 'checkbox';
    hideInput.checked = hideCollected;
    hideInput.addEventListener('change', () => {
      hideCollected = hideInput.checked;
      try { localStorage.setItem(HIDE_KEY, String(hideCollected)); } catch {}
      syncCollected();
    });
    hideRow.append(hideInput, t('Скрыть собранное'));
    panel.append(hideRow);
    progress = document.createElement('div');
    progress.className = 'gf-map-filters__progress';
    panel.append(progress);
    const actions = document.createElement('div');
    actions.className = 'gf-map-filters__actions';
    for (const [label, all] of [[t('Все'), true], [t('Ничего'), false]] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        selected.clear();
        if (all) for (const type of MARKER_TYPES) selected.add(type.id);
        syncFilters();
      });
      actions.append(button);
    }
    panel.append(actions);
    if (!options.compact) {
      if (options.role.userId) {
        proposeButton = document.createElement('button');
        proposeButton.type = 'button';
        proposeButton.className = 'gf-map-filters__suggest';
        proposeButton.textContent = t('Предложить метку');
        proposeButton.addEventListener('click', () => setProposing(!proposing));
        panel.append(proposeButton);
        notice = document.createElement('div');
        notice.className = 'gf-map-filters__notice';
        panel.append(notice);
      } else {
        const guest = document.createElement('p');
        guest.className = 'gf-map-filters__notice';
        guest.textContent = t('Войдите, чтобы предлагать метки');
        panel.append(guest);
      }
      if (options.role.moderator) {
        const link = document.createElement('a');
        link.className = 'gf-map-filters__moderation';
        link.href = `${pageBase()}/map/moderation/`;
        link.textContent = t('Модерация карты');
        panel.append(link);
      }
    }
    root.append(panel);
    return root;
  };
  let syncFilters = () => {};
  control.addTo(map);
  fitPanel();

  let empty: L.Control | undefined;
  if (!markers.length) {
    empty = new L.Control({ position: 'bottomleft' });
    empty.onAdd = () => {
      const notice = L.DomUtil.create('div', 'gf-map-empty');
      notice.textContent = t('Меток пока нет — скоро добавим');
      return notice;
    };
    empty.addTo(map);
  }

  map.on('moveend zoomend', update);
  map.on('resize', fitPanel);
  map.on('click', proposeClick);
  document.addEventListener('keydown', escape);
  const unsubscribe = options.collected.onChange(syncCollected);
  syncCollected();
  update();
  return {
    add(marker) {
      if (destroyed) return;
      markers.push(marker);
      addPin(marker);
      syncCounts();
      syncCollected();
      update();
      empty?.remove();
    },
    open(id) {
      if (destroyed) return false;
      const found = pins.find(item => item.marker.id === id);
      if (!found) return false;
      map.setView(found.pin.getLatLng(), 0);
      selected.add(found.type);
      syncFilters();
      groups.get(found.type)!.addLayer(found.pin);
      found.pin.openPopup();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (formPopup) map.closePopup(formPopup);
      map.off('moveend zoomend', update);
      map.off('resize', fitPanel);
      map.off('click', proposeClick);
      document.removeEventListener('keydown', escape);
      map.getContainer().classList.remove('gf-map--proposing');
      unsubscribe();
      control.remove();
      empty?.remove();
      for (const group of groups.values()) group.remove();
    },
  };
}

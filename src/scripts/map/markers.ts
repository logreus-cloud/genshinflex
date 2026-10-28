import * as L from 'leaflet';
import { t } from '../search';

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
export type MapMarker = { id: number; type: string; x: number; y: number; item: string | null; title: string | null; note: string | null };

const FILTER_KEY = 'gf:map.filters';
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

export async function loadMarkers(layer: string): Promise<MapMarker[]> {
  try {
    const { getSupabase } = await import('../auth');
    const { data, error } = await getSupabase().from('map_markers')
      .select('id,type,x,y,item,title,note')
      .eq('layer', layer).eq('status', 'approved').limit(20000);
    if (error) throw error;
    return (data ?? []) as MapMarker[];
  } catch (error) {
    console.warn('Map markers could not be loaded', error);
    return [];
  }
}

function markerIcon(type: (typeof MARKER_TYPES)[number], compact: boolean) {
  const size = compact ? 18 : 22;
  return L.divIcon({
    className: `gf-marker gf-marker--${type.id}${compact ? ' gf-marker--compact' : ''}`,
    html: `<span class="gf-marker__badge" style="background:${type.color}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${type.glyph}"/></svg></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}
function markerPopup(type: (typeof MARKER_TYPES)[number], marker: MapMarker) {
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
  return popup;
}

export function markerLayer(map: L.Map, markers: MapMarker[], options: { compact?: boolean } = {}): () => void {
  const groups = new Map<MarkerTypeId, L.LayerGroup>();
  const counts = new Map<MarkerTypeId, number>();
  const icons = new Map<MarkerTypeId, L.DivIcon>();
  for (const type of MARKER_TYPES) {
    groups.set(type.id, L.layerGroup());
    counts.set(type.id, 0);
    icons.set(type.id, markerIcon(type, !!options.compact));
  }
  for (const marker of markers) {
    const type = MARKER_TYPES.find(type => type.id === marker.type);
    if (!type) continue;
    const pin = L.marker([-marker.y, marker.x], { icon: icons.get(type.id)! });
    pin.bindPopup(() => markerPopup(type, marker));
    groups.get(type.id)!.addLayer(pin);
    counts.set(type.id, counts.get(type.id)! + 1);
  }

  const selected = savedFilters();
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
    const sync = () => {
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
        sync();
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
      row.append(input, swatch, name, count);
      panel.append(row);
    }
    const actions = document.createElement('div');
    actions.className = 'gf-map-filters__actions';
    for (const [label, all] of [[t('Все'), true], [t('Ничего'), false]] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        selected.clear();
        if (all) for (const type of MARKER_TYPES) selected.add(type.id);
        sync();
      });
      actions.append(button);
    }
    panel.append(actions);
    root.append(panel);
    return root;
  };
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
  update();
  return () => {
    map.off('moveend zoomend', update);
    map.off('resize', fitPanel);
    control.remove();
    empty?.remove();
    for (const group of groups.values()) group.remove();
  };
}

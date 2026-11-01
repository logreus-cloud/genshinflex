import * as L from 'leaflet';
import tiles from '../../data/map-tiles.json';
import { MAP_TILES_URL } from '../../lib/platform';
import { currentUser, getSupabase } from '../auth';
import { loadMarkers, markerLayer } from './markers';
import { createCollectedStore } from './collected';
import { t } from '../search';
import 'leaflet/dist/leaflet.css';
import './map.css';

interface MapOptions { compact?: boolean; }
interface SavedView { lat: number; lng: number; zoom: number; }

const VIEW_KEY = 'gf:map.view';
const LAYER_KEY = 'gf:map.layer';
const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export function mountMap(element: HTMLElement, options: MapOptions = {}): () => void {
  const params = new URLSearchParams(location.search);
  let storedLayer: string | null = null;
  try { storedLayer = localStorage.getItem(LAYER_KEY); } catch {}
  let activeLayer = tiles.layers.find(layer => layer.id === params.get('layer'))
    ?? tiles.layers.find(layer => layer.id === storedLayer)
    ?? tiles.layers.find(layer => layer.id === 'surface') ?? tiles.layers[0]!;
  const configFor = (layer: typeof activeLayer) => {
    const [left, top, right, bottom] = layer.boundsZ12;
    const minNativeZoom = layer.minZoom - layer.maxZoom;
    // весь мир не влезает в окно даже на z9 — дальше Leaflet уменьшает тайлы сам
    const minZoom = minNativeZoom - 2;
    const bounds = L.latLngBounds([[-bottom, left], [-top, right]]);
    return {
      bounds, minNativeZoom, minZoom,
      maxBounds: L.latLngBounds([[-bottom - 512, left - 512], [-top + 512, right + 512]]),
    };
  };
  let config = configFor(activeLayer);
  const map = L.map(element, {
    crs: L.CRS.Simple,
    minZoom: config.minZoom,
    maxZoom: 2,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
    maxBounds: config.maxBounds,
    maxBoundsViscosity: 0.8,
    attributionControl: false,
    zoomControl: false,
  });

  if (!options.compact) L.control.zoom({ position: 'topright' }).addTo(map);

  const addTiles = () => L.tileLayer(`${MAP_TILES_URL}/${activeLayer.id}/{z}/{x}_{y}.png`, {
    minZoom: config.minZoom,
    maxZoom: 2,
    minNativeZoom: config.minNativeZoom,
    maxNativeZoom: 0,
    zoomOffset: activeLayer.maxZoom,
    tileSize: tiles.tileSize,
    noWrap: true,
    bounds: config.bounds,
    keepBuffer: 2,
    errorTileUrl: EMPTY_TILE,
  }).addTo(map);
  let tileLayer = addTiles();

  const markerId = Number(params.get('marker'));
  const openMarker = Number.isSafeInteger(markerId) && markerId > 0 ? markerId : null;
  const restore = () => {
    let saved: SavedView | null = null;
    const key = activeLayer.id === 'surface' ? VIEW_KEY : `${VIEW_KEY}.${activeLayer.id}`;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    if (saved && typeof saved.lat === 'number' && Number.isFinite(saved.lat)
      && typeof saved.lng === 'number' && Number.isFinite(saved.lng)
      && typeof saved.zoom === 'number' && Number.isFinite(saved.zoom)
      && saved.zoom >= config.minZoom && saved.zoom <= 2 && config.bounds.contains([saved.lat, saved.lng])) {
      map.setView([saved.lat, saved.lng], saved.zoom, { animate: false });
    } else {
      map.fitBounds(config.bounds, { animate: false });
    }
  };
  restore();

  const save = () => {
    // запас maxBounds позволяет увести центр за край — храним ближайшую точку покрытия
    const { lat, lng } = map.getCenter();
    const center = L.latLng(
      Math.min(Math.max(lat, config.bounds.getSouth()), config.bounds.getNorth()),
      Math.min(Math.max(lng, config.bounds.getWest()), config.bounds.getEast()));
    const key = activeLayer.id === 'surface' ? VIEW_KEY : `${VIEW_KEY}.${activeLayer.id}`;
    try { localStorage.setItem(key, JSON.stringify({ lat: center.lat, lng: center.lng, zoom: map.getZoom() })); } catch {}
  };
  map.on('moveend zoomend', save);
  // высота контейнера в оверлее меняется без resize окна (полоска обновления)
  const resize = new ResizeObserver(() => map.invalidateSize());
  resize.observe(element);

  let destroyed = false;
  let layer: ReturnType<typeof markerLayer> | undefined;
  let collected: ReturnType<typeof createCollectedStore> | undefined;
  let request = 0;
  let accountId: string | null | undefined;
  let markerOpened = false;
  const clearLayer = () => {
    layer?.destroy();
    layer = undefined;
    collected?.dispose();
    collected = undefined;
  };
  const reload = async () => {
    const turn = ++request;
    const user = await currentUser();
    if (destroyed || turn !== request) return;
    const userId = user?.id ?? null;
    if (accountId !== undefined && accountId !== userId) return;
    accountId = userId;
    let moderator = false;
    if (user) {
      const result = await getSupabase().rpc('map_is_moderator');
      if (destroyed || turn !== request) return;
      moderator = !result.error && result.data === true;
    }
    const markers = await loadMarkers(activeLayer.id);
    if (destroyed || turn !== request || !markers) return;
    clearLayer();
    collected = createCollectedStore(markers.map(marker => marker.id));
    layer = markerLayer(map, markers, {
      ...options, collected, bounds: config.bounds, layer: activeLayer.id,
      role: { userId: user?.id ?? null, moderator },
    });
    if (openMarker && !markerOpened) markerOpened = layer.open(openMarker);
  };
  const { data: auth } = getSupabase().auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null;
    if (accountId === userId) return;
    accountId = userId;
    ++request;
    clearLayer();
    setTimeout(() => {
      if (!destroyed) void reload();
    }, 0);
  });
  void reload();
  const changeLayer = (next: typeof activeLayer) => {
    if (next.id === activeLayer.id) return;
    save();
    map.off('moveend zoomend', save);
    ++request;
    clearLayer();
    markerOpened = true;
    tileLayer.remove();
    activeLayer = next;
    config = configFor(activeLayer);
    map.setMinZoom(config.minZoom);
    map.setMaxBounds(config.maxBounds);
    tileLayer = addTiles();
    restore();
    map.on('moveend zoomend', save);
    try { localStorage.setItem(LAYER_KEY, activeLayer.id); } catch {}
    const url = new URL(location.href);
    if (activeLayer.id === 'surface') url.searchParams.delete('layer');
    else url.searchParams.set('layer', activeLayer.id);
    url.searchParams.delete('marker');
    history.replaceState(history.state, '', url);
    void reload();
  };
  let layerControl: L.Control | undefined;
  if (tiles.layers.length > 1) {
    layerControl = new L.Control({ position: 'topright' });
    layerControl.onAdd = () => {
      const root = L.DomUtil.create('label', `gf-map-layers${options.compact ? ' gf-map-layers--compact' : ''}`);
      L.DomEvent.disableClickPropagation(root);
      L.DomEvent.disableScrollPropagation(root);
      const heading = document.createElement('span');
      heading.textContent = t('Слой карты');
      const select = document.createElement('select');
      select.setAttribute('aria-label', heading.textContent);
      for (const item of tiles.layers) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = t(item.label);
        select.append(option);
      }
      select.value = activeLayer.id;
      select.addEventListener('change', () => {
        const next = tiles.layers.find(item => item.id === select.value);
        if (next) changeLayer(next);
      });
      root.append(heading, select);
      return root;
    };
    layerControl.addTo(map);
  }
  return () => {
    destroyed = true;
    ++request;
    auth.subscription.unsubscribe();
    resize.disconnect();
    clearLayer();
    layerControl?.remove();
    map.remove();
  };
}

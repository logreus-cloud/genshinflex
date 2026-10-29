import * as L from 'leaflet';
import tiles from '../../data/map-tiles.json';
import { MAP_TILES_URL } from '../../lib/platform';
import { currentUser, getSupabase } from '../auth';
import { loadMarkers, markerLayer } from './markers';
import { createCollectedStore } from './collected';
import 'leaflet/dist/leaflet.css';
import './map.css';

interface MapOptions { compact?: boolean; }
interface SavedView { lat: number; lng: number; zoom: number; }

const VIEW_KEY = 'gf:map.view';
const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export function mountMap(element: HTMLElement, options: MapOptions = {}): () => void {
  const [left, top, right, bottom] = tiles.boundsZ12;
  const minNativeZoom = tiles.minZoom - tiles.maxZoom;
  // весь мир не влезает в окно даже на z9 — дальше Leaflet уменьшает тайлы сам
  const minZoom = minNativeZoom - 2;
  const bounds = L.latLngBounds([[-bottom, left], [-top, right]]);
  const map = L.map(element, {
    crs: L.CRS.Simple,
    minZoom,
    maxZoom: 2,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
    maxBounds: L.latLngBounds([[-bottom - 512, left - 512], [-top + 512, right + 512]]),
    maxBoundsViscosity: 0.8,
    attributionControl: false,
    zoomControl: false,
  });

  if (!options.compact) L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer(`${MAP_TILES_URL}/${tiles.layers[0]!.id}/{z}/{x}_{y}.png`, {
    minZoom,
    maxZoom: 2,
    minNativeZoom,
    maxNativeZoom: 0,
    zoomOffset: tiles.maxZoom,
    tileSize: tiles.tileSize,
    noWrap: true,
    bounds,
    keepBuffer: 2,
    errorTileUrl: EMPTY_TILE,
  }).addTo(map);

  let saved: SavedView | null = null;
  const markerId = Number(new URLSearchParams(location.search).get('marker'));
  const openMarker = Number.isSafeInteger(markerId) && markerId > 0 ? markerId : null;
  try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch {}
  if (saved && typeof saved.lat === 'number' && Number.isFinite(saved.lat)
    && typeof saved.lng === 'number' && Number.isFinite(saved.lng)
    && typeof saved.zoom === 'number' && Number.isFinite(saved.zoom)
    && saved.zoom >= minZoom && saved.zoom <= 2 && bounds.contains([saved.lat, saved.lng])) {
    map.setView([saved.lat, saved.lng], saved.zoom);
  } else {
    map.fitBounds(bounds);
  }

  const save = () => {
    // запас maxBounds позволяет увести центр за край — храним ближайшую точку покрытия
    const { lat, lng } = map.getCenter();
    const center = L.latLng(
      Math.min(Math.max(lat, bounds.getSouth()), bounds.getNorth()),
      Math.min(Math.max(lng, bounds.getWest()), bounds.getEast()));
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: center.lat, lng: center.lng, zoom: map.getZoom() })); } catch {}
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
    const markers = await loadMarkers('surface');
    if (destroyed || turn !== request || !markers) return;
    clearLayer();
    collected = createCollectedStore(markers.map(marker => marker.id));
    layer = markerLayer(map, markers, {
      ...options, collected, bounds,
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
  return () => {
    destroyed = true;
    ++request;
    auth.subscription.unsubscribe();
    resize.disconnect();
    clearLayer();
    map.remove();
  };
}

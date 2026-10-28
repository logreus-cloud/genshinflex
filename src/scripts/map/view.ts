import * as L from 'leaflet';
import tiles from '../../data/map-tiles.json';
import { MAP_TILES_URL } from '../../lib/platform';
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
  let removeMarkers: (() => void) | undefined;
  let collected: ReturnType<typeof createCollectedStore> | undefined;
  void loadMarkers('surface').then((markers) => {
    if (destroyed || !markers) return;
    collected = createCollectedStore(markers.map(marker => marker.id));
    removeMarkers = markerLayer(map, markers, { ...options, collected });
  });
  return () => {
    destroyed = true;
    resize.disconnect();
    removeMarkers?.();
    collected?.dispose();
    map.remove();
  };
}

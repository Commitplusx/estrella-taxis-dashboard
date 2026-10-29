import L from 'leaflet';

/** Shared visible tiles only: no prefetching, offline download or geocoding. */
export function openStreetMapLayer(onErrorState?: (failed: boolean) => void): L.TileLayer {
  const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  let cycleFailed = false;
  layer.on('loading', () => { cycleFailed = false; });
  layer.on('tileerror', () => { cycleFailed = true; onErrorState?.(true); });
  layer.on('load', () => onErrorState?.(cycleFailed));
  return layer;
}

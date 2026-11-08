import * as L from 'leaflet';

window.L = L;
try {
  const { maplibreGL } = await import('https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.mjs');
  window.CardropMapLibreGL = maplibreGL;
} catch {
  // The application still loads and the map module falls back to raster OSM.
  window.CardropMapLibreGL = null;
}
await import('./app.js');

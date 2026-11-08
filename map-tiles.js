(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CardropMapTiles = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const hotAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · стиль <a href="https://www.hotosm.org/" target="_blank" rel="noopener noreferrer">HOT</a>';
  const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

  function mount(L, map, _config = {}, onChange = function () {}) {
    const container = map.getContainer();
    let activeLayer, switchedToFallback = false;
    const common = { tileSize: 256, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1 };

    function useOsmFallback() {
      if (switchedToFallback) return;
      switchedToFallback = true;
      if (activeLayer) map.removeLayer(activeLayer);
      activeLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        ...common, maxZoom: 19, attribution: osmAttribution
      }).addTo(map);
      onChange({ provider: 'osm', reason: 'fallback' });
    }

    activeLayer = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      ...common, subdomains: 'abc', maxZoom: 19, attribution: hotAttribution
    });
    // If the alternate tile service is unavailable, preserve map functionality.
    activeLayer.on('tileerror', useOsmFallback);
    activeLayer.addTo(map);
    onChange({ provider: 'hot', reason: 'configured' });
    return { getLayer: () => activeLayer };
  }
  return { mount };
});

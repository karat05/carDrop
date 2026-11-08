(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CardropMapTiles = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const libertyStyle = 'https://tiles.openfreemap.org/styles/liberty';
  const libertyAttribution = '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles · данные OpenStreetMap</a>';
  const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

  function mount(L, map, _config = {}, onChange = function () {}) {
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

    try {
      activeLayer = window.CardropMapLibreGL({ style: libertyStyle });
      // Preserve both required credits while keeping one compact attribution link.
      if (typeof activeLayer.getAttribution === 'function') {
        activeLayer.getAttribution = () => libertyAttribution;
      }
      activeLayer.addTo(map);
      const glMap = activeLayer.getMaplibreMap();
      let resourceErrors = 0;
      glMap.on('error', event => {
        if (event.error && ++resourceErrors >= 4) useOsmFallback();
      });
      onChange({ provider: 'liberty', reason: 'configured' });
    } catch {
      useOsmFallback();
    }
    return { getLayer: () => activeLayer };
  }
  return { mount };
});

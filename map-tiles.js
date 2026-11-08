(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CardropMapTiles = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const yandexAttribution = '&copy; <a href="https://yandex.ru/maps/" target="_blank" rel="noopener noreferrer">Яндекс</a>';
  const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

  function yandexTileUrl(key) {
    if (!key || !key.trim()) throw new Error('Yandex Tiles API key is required');
    // Leaflet uses EPSG:3857. Explicit Web Mercator prevents displaced roads/markers.
    return 'https://tiles.api-maps.yandex.ru/v1/tiles/?apikey=' + encodeURIComponent(key.trim()) +
      '&lang=ru_RU&l=map&maptype=driving&projection=web_mercator&scale=1&x={x}&y={y}&z={z}';
  }

  function mount(L, map, config = {}, onChange = function () {}) {
    const container = map.getContainer();
    let activeLayer, logo, switchedToFallback = false;
    const common = { tileSize: 256, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1 };
    function useOsm(reason) {
      if (switchedToFallback) return;
      switchedToFallback = true;
      if (activeLayer) map.removeLayer(activeLayer);
      if (logo) map.removeControl(logo);
      container.classList.remove('map-yandex');
      map.setMaxZoom(18);
      activeLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        ...common, maxZoom: 18, attribution: osmAttribution
      }).addTo(map);
      onChange({provider: 'osm', reason});
    }

    const key = String(config.yandexTilesApiKey || '').trim();
    if (!key) { useOsm('not-configured'); return { getLayer: () => activeLayer }; }
    container.classList.add('map-yandex');
    map.setMaxZoom(20);
    logo = L.control({position: 'topleft'});
    logo.onAdd = function () {
      const anchor = L.DomUtil.create('a', 'yandex-logo');
      anchor.href = 'https://yandex.ru/maps/'; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      anchor.setAttribute('aria-label', 'Открыть Яндекс Карты');
      const img = L.DomUtil.create('img', '', anchor);
      img.src = 'assets/yandex-logo.svg'; img.alt = 'Яндекс'; img.width = 88; img.height = 48;
      L.DomEvent.disableClickPropagation(anchor); L.DomEvent.disableScrollPropagation(anchor);
      return anchor;
    };
    logo.addTo(map);
    activeLayer = L.tileLayer(yandexTileUrl(key), {
      ...common, maxZoom: 20, attribution: yandexAttribution,
      referrerPolicy: 'strict-origin-when-cross-origin'
    });
    // Invalid key, denied domain, quota or network failure must not leave a blank map.
    activeLayer.on('tileerror', function () { useOsm('tile-error'); });
    activeLayer.addTo(map);
    if (!switchedToFallback) onChange({provider: 'yandex', reason: 'configured'});
    return { getLayer: () => activeLayer };
  }
  return { mount, yandexTileUrl };
});

(() => {
  const rate = 50;
  const inputs = { from: document.querySelector('#fromInput'), to: document.querySelector('#toInput') };
  const suggestions = { from: document.querySelector('#fromSuggest'), to: document.querySelector('#toSuggest') };
  const points = {
    from: { name: 'Москва', lat: 55.7558, lon: 37.6173 },
    to: { name: 'Казань', lat: 55.7961, lon: 49.1064 }
  };
  const markerStyles = {
    from: 'background:#829354;box-shadow:0 0 0 5px #82935430',
    to: 'background:#e1ad2e;box-shadow:0 0 0 5px #e1ad2e38'
  };
  let map, markers = {}, routeLine, routeDistanceMeters = null;
  let clickNext = 'from', searchTimers = {}, routeToken = 0, lastRouteRequestAt = 0;
  const routeStatus = document.querySelector('#routeStatus');

  const iconFor = key => L.divIcon({ className: '', html: `<span style="display:block;width:14px;height:14px;border:3px solid #f7f5ed;border-radius:50%;${markerStyles[key]}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] });
  const displayName = address => address.city || address.town || address.village || address.municipality || address.county || '';
  const localityFromPhoton = p => p.city || p.locality || p.district || p.county || p.state || '';
  function placeLabel(place) {
    const address = place.address || place.properties || {};
    const street = address.road || address.pedestrian || address.residential || address.street || address.name || '';
    const house = address.house_number || address.housenumber || '';
    const locality = displayName(address) || localityFromPhoton(address);
    const streetAddress = [street, house].filter(Boolean).join(', ');
    if (streetAddress && locality && !streetAddress.toLowerCase().includes(locality.toLowerCase())) return `${streetAddress}, ${locality}`;
    if (streetAddress) return streetAddress;
    if (locality) return locality;
    return place.display_name || place.properties?.name || place.name || 'Выбранная точка';
  }

  function normalizePhoton(feature) {
    const p = feature.properties || {};
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const address = {
      road: p.street || '', house_number: p.housenumber || '', city: p.city || p.locality || '',
      town: p.city || p.locality || '', village: p.city || p.locality || '', district: p.district || '',
      county: p.county || '', state: p.state || ''
    };
    const parts = [p.name, p.street && p.street !== p.name ? p.street : '', p.housenumber, p.city || p.locality, p.state].filter(Boolean);
    return { lat: String(lat), lon: String(lon), address, display_name: [...new Set(parts)].join(', '), name: p.name || '' };
  }

  function setRouteStatus(message, kind = '') {
    routeStatus.textContent = message;
    routeStatus.parentElement.classList.toggle('route-error', kind === 'error');
    routeStatus.parentElement.classList.toggle('route-success', kind === 'success');
  }

  function renderEstimate() {
    document.querySelector('#estimateFrom').textContent = points.from.name || 'Точка отправления';
    document.querySelector('#estimateTo').textContent = points.to.name || 'Точка доставки';
    if (routeDistanceMeters === null) {
      document.querySelector('#distanceValue').textContent = '— км';
      document.querySelector('#priceValue').innerHTML = '— <span>₽</span>';
      return;
    }
    const km = routeDistanceMeters / 1000;
    const kmText = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: km % 1 > .05 ? 1 : 0, maximumFractionDigits: 1 }).format(km);
    document.querySelector('#distanceValue').textContent = `${kmText} км`;
    document.querySelector('#priceValue').innerHTML = `${Math.round(km * rate).toLocaleString('ru-RU')} <span>₽</span>`;
  }

  async function requestRoadRoute() {
    const token = ++routeToken;
    routeDistanceMeters = null;
    if (routeLine && map) { map.removeLayer(routeLine); routeLine = null; }
    renderEstimate();
    if (!map || !points.from || !points.to) return;

    const waitMs = Math.max(0, 1200 - (Date.now() - lastRouteRequestAt));
    setRouteStatus(waitMs ? 'Обновляем автомобильный маршрут…' : 'Прокладываем автомобильный маршрут…');
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    if (token !== routeToken) return;

    const coords = `${points.from.lon},${points.from.lat};${points.to.lon},${points.to.lat}`;
    const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=simplified&geometries=geojson&alternatives=false&steps=false`;
    lastRouteRequestAt = Date.now();
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('routing service unavailable');
      const result = await response.json();
      if (token !== routeToken) return;
      const route = result.code === 'Ok' && result.routes?.[0];
      if (!route || !Number.isFinite(route.distance) || !route.geometry?.coordinates?.length) throw new Error('route not found');

      routeDistanceMeters = route.distance;
      const latlngs = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      routeLine = L.polyline(latlngs, { color: '#879652', weight: 4, opacity: .95 }).addTo(map);
      renderEstimate();
      setRouteStatus('Автомобильный маршрут построен', 'success');
    } catch {
      if (token !== routeToken) return;
      routeDistanceMeters = null;
      renderEstimate();
      setRouteStatus('Не удалось построить дорожный маршрут. Попробуйте другие точки.', 'error');
    }
  }

  function setPoint(key, point, center = false) {
    const previous = points[key];
    const coordinatesChanged = !previous || previous.lat !== point.lat || previous.lon !== point.lon;
    points[key] = point;
    inputs[key].value = point.name;
    if (!map) return renderEstimate();
    if (markers[key]) markers[key].setLatLng([point.lat, point.lon]);
    else markers[key] = L.marker([point.lat, point.lon], { icon: iconFor(key), keyboard: true, title: key === 'from' ? 'Точка отправления' : 'Точка доставки' }).addTo(map);
    if (markers.from && markers.to && center) {
      map.fitBounds(L.latLngBounds([[points.from.lat, points.from.lon], [points.to.lat, points.to.lon]]).pad(.55), { maxZoom: 7, animate: true });
    } else if (center) map.setView([point.lat, point.lon], 7);
    if (coordinatesChanged && markers.from && markers.to) requestRoadRoute();
    renderEstimate();
  }

  async function geocode(query) {
    const encoded = encodeURIComponent(query);
    const photonUrl = `https://photon.komoot.io/api/?q=${encoded}&lang=ru&limit=8&lat=${points.from.lat}&lon=${points.from.lon}&countrycode=RU`;
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&countrycodes=ru&q=${encoded}`;
    const responses = await Promise.allSettled([
      fetch(photonUrl, { headers: { 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(7000) }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(nominatimUrl, { headers: { 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(9000) }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
    ]);
    const photon = responses[0].status === 'fulfilled' ? (responses[0].value.features || []).map(normalizePhoton).filter(Boolean) : [];
    const nominatim = responses[1].status === 'fulfilled' ? responses[1].value : [];
    const results = [...nominatim, ...photon];
    const unique = new Map();
    for (const place of results) {
      const key = `${Number(place.lat).toFixed(5)},${Number(place.lon).toFixed(5)}`;
      if (!unique.has(key)) unique.set(key, place);
    }
    if (!unique.size && responses.every(r => r.status === 'rejected')) throw new Error('Не удалось выполнить поиск');
    return [...unique.values()].slice(0, 8);
  }

  function showSuggestions(key, results) {
    const box = suggestions[key];
    box.replaceChildren();
    if (!results.length) {
      const empty = document.createElement('div'); empty.className = 'suggestion'; empty.textContent = 'Ничего не найдено'; box.append(empty);
    }
    results.forEach(place => {
      const row = document.createElement('div'); row.className = 'suggestion';
      const label = placeLabel(place);
      row.textContent = place.display_name || label;
      row.title = place.display_name || label;
      row.addEventListener('mousedown', event => {
        event.preventDefault();
        setPoint(key, { name: label, lat: Number(place.lat), lon: Number(place.lon) }, true);
        box.classList.remove('open'); clickNext = key === 'from' ? 'to' : 'from';
      });
      box.append(row);
    });
    box.classList.add('open');
  }

  async function resolveInput(key) {
    const query = inputs[key].value.trim();
    if (!query) return;
    if (query === points[key].name) return;
    suggestions[key].innerHTML = '<div class="suggestion">Ищем на карте…</div>';
    suggestions[key].classList.add('open');
    try {
      const results = await geocode(query);
      if (results.length) {
        const place = results[0];
        setPoint(key, { name: placeLabel(place), lat: Number(place.lat), lon: Number(place.lon) }, true);
        clickNext = key === 'from' ? 'to' : 'from';
      } else showSuggestions(key, []);
    } catch {
      suggestions[key].innerHTML = '<div class="suggestion">Поиск временно недоступен. Попробуйте позже.</div>';
      suggestions[key].classList.add('open');
    }
  }

  async function highlightRussia() {
    const url = 'russia.geojson';
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('boundary unavailable');
      const country = await response.json();
      L.geoJSON(country, { style: { color: '#72834c', weight: 1.7, opacity: .9, fillColor: '#b8cb72', fillOpacity: .18 } }).addTo(map);
    } catch {
      // Монохромная подложка всё ещё отделяет Россию от остальных стран.
    }
  }

  function initMap() {
    if (!window.L) {
      document.querySelector('#mapLoading').innerHTML = 'Карта временно недоступна. Используйте поиск по городам.';
      setRouteStatus('Карта временно недоступна', 'error');
      return;
    }
    map = L.map('map', { zoomControl: false, scrollWheelZoom: true, wheelPxPerZoomLevel: 100 }).setView([61.5, 93], 3);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    highlightRussia();
    map.on('click', async event => {
      const key = clickNext;
      const point = { name: `Точка ${event.latlng.lat.toFixed(2)}, ${event.latlng.lng.toFixed(2)}`, lat: event.latlng.lat, lon: event.latlng.lng };
      setPoint(key, point);
      clickNext = key === 'from' ? 'to' : 'from';
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lon}&zoom=10&addressdetails=1`, { headers: { 'Accept-Language': 'ru' } });
        if (response.ok) {
          const data = await response.json(), label = placeLabel(data);
          if (label) setPoint(key, { ...point, name: label });
        }
      } catch { /* Координаты точки уже сохранены и остаются доступны. */ }
    });
    setPoint('from', points.from);
    setPoint('to', points.to, true);
    requestRoadRoute();
    document.querySelector('#mapLoading').classList.add('hidden');
    setTimeout(() => map.invalidateSize(), 80);
  }

  for (const key of ['from', 'to']) {
    inputs[key].addEventListener('input', () => {
      clearTimeout(searchTimers[key]);
      const query = inputs[key].value.trim();
      if (query.length < 2) { suggestions[key].classList.remove('open'); return; }
      searchTimers[key] = setTimeout(async () => {
        try { showSuggestions(key, await geocode(query)); }
        catch { suggestions[key].classList.remove('open'); }
      }, 550);
    });
    inputs[key].addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); resolveInput(key); }
      if (event.key === 'Escape') suggestions[key].classList.remove('open');
    });
    inputs[key].addEventListener('blur', () => setTimeout(() => suggestions[key].classList.remove('open'), 120));
    inputs[key].closest('.field').querySelector('.clear-input').addEventListener('click', () => {
      inputs[key].value = ''; inputs[key].focus(); suggestions[key].classList.remove('open');
    });
  }

  document.querySelector('#swapRoute').addEventListener('click', () => {
    const a = { ...points.from }, b = { ...points.to };
    setPoint('from', b); setPoint('to', a, true); clickNext = 'from';
  });
  document.querySelector('#locateMe').addEventListener('click', () => {
    if (!navigator.geolocation) return alert('Браузер не поддерживает определение геопозиции.');
    navigator.geolocation.getCurrentPosition(position => {
      const p = position.coords;
      setPoint(clickNext, { name: 'Моя геопозиция', lat: p.latitude, lon: p.longitude }, true);
      clickNext = clickNext === 'from' ? 'to' : 'from';
    }, () => alert('Не удалось определить местоположение. Проверьте разрешение браузера.'));
  });
  let helpers = 0;
  const helperWord = count => count === 1 ? 'грузчик' : count >= 2 && count <= 4 ? 'грузчика' : 'грузчиков';
  function renderHelpers() {
    document.querySelector('#helpersCount').textContent = helpers;
    document.querySelector('#helpersNote').textContent = helpers ? `${helpers} ${helperWord(helpers)}` : 'Не нужны';
    document.querySelector('#helpersMinus').disabled = helpers === 0;
    document.querySelector('#helpersPlus').disabled = helpers === 6;
  }
  document.querySelector('#helpersMinus').addEventListener('click', () => { helpers = Math.max(0, helpers - 1); renderHelpers(); });
  document.querySelector('#helpersPlus').addEventListener('click', () => { helpers = Math.min(6, helpers + 1); renderHelpers(); });
  document.querySelector('.menu-toggle').addEventListener('click', () => document.querySelector('.nav').classList.toggle('open'));
  document.querySelectorAll('.nav a').forEach(link => link.addEventListener('click', () => document.querySelector('.nav').classList.remove('open')));

  renderEstimate();
  renderHelpers();
  if (document.readyState === 'complete') initMap();
  else window.addEventListener('load', initMap, { once: true });
})();



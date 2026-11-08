(() => {
  const L = window.L;
  const rate = 50;
  const maxShareUrl = 'https://max.ru/:share';
  // OpenStreetMap building way/169667848: exact address confirmed at setup.
  const depot = Object.freeze({ name: 'улица Пески Набережные, 1, Александров', lat: 56.3992489, lon: 38.7328341 });
  const inputs = { from: document.querySelector('#fromInput'), to: document.querySelector('#toInput') };
  const suggestions = { from: document.querySelector('#fromSuggest'), to: document.querySelector('#toSuggest') };
  const points = {
    from: { name: 'Москва', lat: 55.7558, lon: 37.6173 },
    to: { name: 'Казань', lat: 55.7961, lon: 49.1064 }
  };
  const markerStyles = {
    from: 'background:#648496;box-shadow:0 0 0 5px #64849630',
    to: 'background:#e4ad54;box-shadow:0 0 0 5px #e4ad5438'
  };
  const pages = [...document.querySelectorAll('.wizard-page')];
  const routeStatus = document.querySelector('#routeStatus');
  const nextRouteButton = document.querySelector('#nextFromRoute');
  let map, markers = {}, routeLine, routeDistanceMeters = null, routeLegs = null;
  let clickNext = 'from', searchTimers = {}, routeToken = 0, lastRouteRequestAt = 0, lastNominatimRequestAt = 0;
  let currentStep = 1;

  const formatMoney = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
  const formatKm = value => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: value % 1 > .05 ? 1 : 0, maximumFractionDigits: 1 }).format(value);
  const helperWord = count => count === 1 ? 'грузчик' : count >= 2 && count <= 4 ? 'грузчика' : 'грузчиков';
  const tripFields = [...document.querySelectorAll('[data-trip-detail]')];
  const floorName = floor => floor === '' ? 'не указан' : floor === '0' ? '1 / без подъёма' : floor === '10' ? '10 и выше' : floor;
  const liftName = (enabled, type) => !enabled ? 'без лифта' : type === 'cargo' ? 'грузовой лифт' : type === 'passenger' ? 'обычный пассажирский лифт' : 'тип не указан';

  const storage = {
    get(key) { try { return localStorage.getItem(`cardrop-trip-${key}`); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(`cardrop-trip-${key}`, value); } catch { /* Продолжаем без сохранения между визитами. */ } }
  };

  const iconFor = key => L.divIcon({ className: '', html: `<span style="display:block;width:14px;height:14px;border:3px solid #f7f5ed;border-radius:50%;${markerStyles[key]}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] });
  const displayName = address => address?.city || address?.town || address?.village || address?.municipality || address?.county || '';
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
    const properties = feature.properties || {};
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const address = {
      road: properties.street || '', house_number: properties.housenumber || '',
      city: properties.city || properties.locality || '', town: properties.city || properties.locality || '',
      village: properties.city || properties.locality || '', district: properties.district || '',
      county: properties.county || '', state: properties.state || ''
    };
    const parts = [properties.name, properties.street && properties.street !== properties.name ? properties.street : '', properties.housenumber, properties.city || properties.locality, properties.state].filter(Boolean);
    return { lat: String(lat), lon: String(lon), address, display_name: [...new Set(parts)].join(', '), name: properties.name || '' };
  }

  function setRouteStatus(message, kind = '') {
    routeStatus.textContent = message;
    routeStatus.parentElement.classList.toggle('route-error', kind === 'error');
    routeStatus.parentElement.classList.toggle('route-success', kind === 'success');
  }

  function currentDetails() {
    return Object.fromEntries(tripFields.map(field => [field.dataset.tripDetail, field.type === 'checkbox' ? field.checked : field.value.trim()]));
  }

  function detailsLines() {
    const d = currentDetails();
    const lines = [];
    if (d.cargo) lines.push(`Груз: ${d.cargo}`);
    if (d.weight) lines.push(`Вес: ${formatMoney(Number(d.weight))} кг`);
    if (d.volume) lines.push(`Объём: ${d.volume} м³`);
    const helpers = Number(d.helpers || 0);
    lines.push(helpers ? `Грузчики: ${helpers} ${helperWord(helpers)}` : 'Без грузчиков');
    if (d.fromFloor !== '' || d.fromLift) lines.push(`Погрузка: этаж ${floorName(d.fromFloor)}, ${liftName(d.fromLift, d.fromLiftType)}`);
    if (d.toFloor !== '' || d.toLift) lines.push(`Выгрузка: этаж ${floorName(d.toFloor)}, ${liftName(d.toLift, d.toLiftType)}`);
    if (d.date) lines.push(`Дата: ${new Intl.DateTimeFormat('ru-RU').format(new Date(`${d.date}T12:00:00`))}`);
    if (d.time) lines.push(`Время: ${d.time}`);
    if (d.comment) lines.push(`Комментарий: ${d.comment}`);
    return lines;
  }

  function createMaxMessage() {
    const km = routeDistanceMeters === null ? 'не рассчитано' : `${formatKm(routeDistanceMeters / 1000)} км`;
    const base = routeDistanceMeters === null ? 'не рассчитана' : `${formatMoney(Math.round(routeDistanceMeters / 1000 * rate))} ₽`;
    const d = currentDetails();
    const date = d.date ? new Intl.DateTimeFormat('ru-RU').format(new Date(`${d.date}T12:00:00`)) : 'согласуем';
    const time = d.time || 'согласуем';
    return [
      'ЗАЯВКА НА ПЕРЕВОЗКУ', '',
      '📍 МАРШРУТ', `Старт с базы: ${depot.name}`, `Погрузка: ${inputs.from.value.trim() || 'не указано'}`, `Доставка: ${inputs.to.value.trim() || 'не указано'}`,
      ...(routeLegs ? [`База → погрузка: ${formatKm(routeLegs[0] / 1000)} км`, `Погрузка → доставка: ${formatKm(routeLegs[1] / 1000)} км`] : []),
      `Всего по дорогам: ${km}`, 'Возвращение на базу не включено.', '',
      '📦 ГРУЗ И ПОГРУЗКА',
      `Что перевозим: ${d.cargo || 'уточню в чате'}`,
      `Вес: ${d.weight ? `${d.weight} кг` : 'не указан'} · Объём: ${d.volume ? `${d.volume} м³` : 'не указан'}`,
      ...detailsLines().filter(line => !/^(Груз:|Вес:|Объём:|Дата:|Время:|Комментарий:)/.test(line)), '',
      '📅 ДАТА И ПОЖЕЛАНИЯ', `Желаемая дата: ${date}`, `Удобное время: ${time}`, `Комментарий: ${d.comment || 'нет'}`, '',
      '💰 ПРИМЕРНАЯ ЦЕНА С САЙТА', `Ориентир за дорогу: ${base}`, 'Расчёт по тарифу 50 ₽/км. Грузчики и дополнительные услуги в сумму не включены — итог согласуем лично в мессенджере.', '',
      'Здравствуйте! Прошу уточнить итоговую стоимость и свободное время для перевозки.'
    ].join('\n');
  }

  function renderEstimate() {
    document.querySelector('#estimateFrom').textContent = points.from.name || 'Точка отправления';
    document.querySelector('#estimateTo').textContent = points.to.name || 'Точка доставки';
    document.querySelectorAll('[data-route-leg="pickup"]').forEach(el => el.textContent = routeLegs ? `${formatKm(routeLegs[0] / 1000)} км` : '— км');
    document.querySelectorAll('[data-route-leg="delivery"]').forEach(el => el.textContent = routeLegs ? `${formatKm(routeLegs[1] / 1000)} км` : '— км');
    const estimateDetails = detailsLines();
    const visibleDetails = estimateDetails.filter(line => !line.startsWith('Комментарий:')).slice(0, 8);
    document.querySelector('#estimateDetails').textContent = visibleDetails.length ? visibleDetails.join(' · ') : 'Укажите условия груза на следующем шаге';
    document.querySelector('#messagePreview').value = createMaxMessage();
    const message = createMaxMessage();
    const share = new URL(maxShareUrl); share.searchParams.set('text', message); document.querySelector('#maxCta').href = share.toString();
    const whatsapp = new URL('https://wa.me/79163490715'); whatsapp.searchParams.set('text', message); document.querySelector('#waCta').href = whatsapp.toString();
    const canRoute = routeDistanceMeters !== null;
    nextRouteButton.disabled = !canRoute;
    if (!canRoute) {
      document.querySelector('#distanceValue').textContent = '— км';
      document.querySelector('#priceValue').textContent = '— ₽';
      document.querySelector('#finalDistance').textContent = '— км';
      document.querySelector('#finalPrice').textContent = '— ₽';
      return;
    }

    const km = routeDistanceMeters / 1000;
    const basePrice = Math.round(km * rate);
    document.querySelector('#distanceValue').textContent = `${formatKm(km)} км`;
    document.querySelector('#priceValue').textContent = `${formatMoney(basePrice)} ₽`;
    document.querySelector('#finalDistance').textContent = `${formatKm(km)} км`;
    document.querySelector('#finalPrice').textContent = `${formatMoney(basePrice)} ₽`;
    document.querySelector('#finalRouteFrom').textContent = points.from.name;
    document.querySelector('#finalRouteTo').textContent = points.to.name;
    document.querySelector('#finalDetails').innerHTML = estimateDetails.map(line => `<span>${escapeHtml(line)}</span>`).join('');
    const maxUrl = new URL(maxShareUrl);
    maxUrl.searchParams.set('text', createMaxMessage());
    document.querySelector('#maxCta').href = maxUrl.toString();
    const whatsappUrl = new URL('https://wa.me/79163490715');
    whatsappUrl.searchParams.set('text', createMaxMessage());
    document.querySelector('#waCta').href = whatsappUrl.toString();
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function showStep(step, scroll = true) {
    currentStep = step;
    const copyAction = document.querySelector('#copyAction');
    copyAction.hidden = step === 1;
    document.querySelector('#quoteToolbarMessage').textContent = step === 1
      ? 'Заполните маршрут и детали — после этого можно будет скопировать заявку'
      : 'Одна заявка для MAX или WhatsApp';
    if (step === 1) document.querySelector('#copyStatus').textContent = '';
    for (const page of pages) {
      const active = Number(page.dataset.page) === step;
      page.hidden = !active;
      page.classList.toggle('active', active);
    }
    document.querySelectorAll('.wizard-progress-step').forEach(item => {
      const number = Number(item.dataset.progress);
      item.classList.toggle('active', number === step);
      item.classList.toggle('complete', number < step);
    });
    document.querySelector('#estimateCard').classList.toggle('hidden', step === 3);
    if (step === 1 && map) setTimeout(() => map.invalidateSize(), 80);
    if (scroll && window.matchMedia('(max-width: 700px)').matches) document.querySelector('#calculator').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function samePoint(a, b) {
    return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lon - b.lon) < 0.00001;
  }

  async function requestRoadRoute() {
    const token = ++routeToken;
    routeDistanceMeters = null;
    routeLegs = null;
    if (routeLine && map) { map.removeLayer(routeLine); routeLine = null; }
    renderEstimate();
    if (!map || !points.from || !points.to) return;
    if (inputs.from.value.trim() !== points.from.name || inputs.to.value.trim() !== points.to.name) {
      setRouteStatus('Выберите адрес погрузки и доставки из подсказок или на карте.');
      return;
    }
    if (samePoint(points.from, points.to)) {
      setRouteStatus('Выберите разные точки отправления и доставки.', 'error');
      return;
    }

    const waitMs = Math.max(0, 1200 - (Date.now() - lastRouteRequestAt));
    setRouteStatus(waitMs ? 'Обновляем дорожный маршрут…' : 'Прокладываем автомобильный маршрут…');
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    if (token !== routeToken) return;

    const coords = [depot, points.from, points.to].map(point => `${point.lon},${point.lat}`).join(';');
    const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    lastRouteRequestAt = Date.now();
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('routing service unavailable');
      const result = await response.json();
      if (token !== routeToken) return;
      const route = result.code === 'Ok' && result.routes?.[0];
      if (!route || !Number.isFinite(route.distance) || !route.geometry?.coordinates?.length || route.legs?.length !== 2 || !route.legs.every(leg => Number.isFinite(leg.distance))) throw new Error('route not found');

      routeDistanceMeters = route.distance;
      routeLegs = route.legs.map(leg => leg.distance);
      const latlngs = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      routeLine = L.polyline(latlngs, { color: '#648496', weight: 5, opacity: .98, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      for (const [key, waypoint] of [['from', result.waypoints?.[1]], ['to', result.waypoints?.[2]]]) {
        const snapped = waypoint?.location;
        if (snapped && markers[key]) markers[key].setLatLng([snapped[1], snapped[0]]);
      }
      renderEstimate();
      setRouteStatus('Автомобильный маршрут построен', 'success');
    } catch {
      if (token !== routeToken) return;
      routeDistanceMeters = null;
      routeLegs = null;
      renderEstimate();
      setRouteStatus('Не удалось построить маршрут по дорогам. Уточните адреса или выберите точки на карте.', 'error');
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
    if (markers.from && markers.to && center) map.fitBounds(L.latLngBounds([depot, points.from, points.to].map(point => [point.lat, point.lon])).pad(.2), { maxZoom: 12, animate: true });
    else if (center) map.setView([point.lat, point.lon], 7);
    if (coordinatesChanged && markers.from && markers.to) requestRoadRoute();
    renderEstimate();
  }

  async function geocodePhoton(query) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=ru&limit=8&lat=${points.from.lat}&lon=${points.from.lon}&countrycode=RU`;
    const response = await fetch(url, { headers: { 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error('Photon unavailable');
    const json = await response.json();
    return (json.features || []).map(normalizePhoton).filter(Boolean);
  }

  async function geocodeNominatim(query) {
    const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastNominatimRequestAt = Date.now();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&countrycodes=ru&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error('Nominatim unavailable');
    return response.json();
  }

  function showSuggestions(key, results) {
    const box = suggestions[key];
    box.replaceChildren();
    if (!results.length) {
      const empty = document.createElement('div'); empty.className = 'suggestion'; empty.textContent = 'Не нашли адрес. Уточните улицу и дом или выберите точку на карте.'; box.append(empty);
    }
    results.forEach(place => {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'suggestion';
      const label = placeLabel(place);
      row.textContent = place.display_name || label;
      row.title = place.display_name || label;
      row.addEventListener('mousedown', event => event.preventDefault());
      row.addEventListener('click', () => {
        setPoint(key, { name: label, lat: Number(place.lat), lon: Number(place.lon) }, true);
        box.classList.remove('open'); clickNext = key === 'from' ? 'to' : 'from';
      });
      box.append(row);
    });
    box.classList.add('open');
  }

  async function resolveInput(key) {
    const query = inputs[key].value.trim();
    if (!query) { showSuggestions(key, []); return false; }
    if (query === points[key].name) { if (routeDistanceMeters === null) await requestRoadRoute(); return true; }
    suggestions[key].replaceChildren();
    const loading = document.createElement('div'); loading.className = 'suggestion'; loading.textContent = 'Ищем адрес…';
    suggestions[key].append(loading); suggestions[key].classList.add('open');
    try {
      let results = [];
      try { results = await geocodePhoton(query); } catch { /* Nominatim ниже — адресный fallback только по запросу пользователя. */ }
      if (!results.length) results = await geocodeNominatim(query);
      if (!results.length) { showSuggestions(key, []); return false; }
      const place = results[0];
      setPoint(key, { name: placeLabel(place), lat: Number(place.lat), lon: Number(place.lon) }, true);
      suggestions[key].classList.remove('open');
      clickNext = key === 'from' ? 'to' : 'from';
      return true;
    } catch {
      suggestions[key].replaceChildren();
      const error = document.createElement('div'); error.className = 'suggestion'; error.textContent = 'Поиск временно недоступен. Выберите точку на карте или попробуйте позже.';
      suggestions[key].append(error); suggestions[key].classList.add('open');
      return false;
    }
  }

  async function reverseGeocode(point) {
    try {
      const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastNominatimRequestAt = Date.now();
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lon}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(9000) });
      if (response.ok) {
        const place = await response.json();
        const label = placeLabel(place);
        if (label) setPoint(point.key, { ...point, name: label });
      }
    } catch { /* Координаты выбранной точки остаются доступны. */ }
  }

  async function highlightRussia() {
    try {
      const response = await fetch('russia.geojson');
      if (!response.ok) throw new Error('boundary unavailable');
      const country = await response.json();
      L.geoJSON(country, { style: { color: '#72834c', weight: 1.7, opacity: .9, fillColor: '#b8cb72', fillOpacity: .18 } }).addTo(map);
    } catch { /* Монохромная подложка всё ещё отделяет Россию. */ }
  }

  function initMap() {
    if (!window.L) {
      document.querySelector('#mapLoading').innerHTML = 'Карта временно недоступна. Используйте поиск адреса.';
      setRouteStatus('Карта временно недоступна', 'error');
      return;
    }
    map = L.map('map', { zoomControl: false, scrollWheelZoom: true, wheelPxPerZoomLevel: 100 }).setView([61.5, 93], 3);
    map.attributionControl.setPrefix(false);
    window.CardropMapTiles.mount(L, map, window.CARDROP_MAP_CONFIG, state => {
      document.querySelector('#mapProvider').textContent = state.provider === 'liberty'
        ? 'Карта: OpenFreeMap · Liberty'
        : 'Карта: OpenStreetMap · резервная подложка';
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.marker([depot.lat, depot.lon], {
      draggable: false, keyboard: true, title: `База (закреплена): ${depot.name}`,
      icon: L.divIcon({className: '', html: '<span class="depot-marker" aria-hidden="true">Б</span>', iconSize: [28,28], iconAnchor: [14,14]})
    }).addTo(map).bindPopup(`База · закреплена<br>${depot.name}`);
    highlightRussia();
    map.on('click', event => {
      const key = clickNext;
      const point = { key, name: `Точка ${event.latlng.lat.toFixed(4)}, ${event.latlng.lng.toFixed(4)}`, lat: event.latlng.lat, lon: event.latlng.lng };
      setPoint(key, point);
      clickNext = key === 'from' ? 'to' : 'from';
      reverseGeocode(point);
    });
    setPoint('from', points.from);
    setPoint('to', points.to, true);
    requestRoadRoute();
    document.querySelector('#mapLoading').classList.add('hidden');
    setTimeout(() => map.invalidateSize(), 80);
  }

  function setDateMinimum() {
    const dateField = document.querySelector('[data-trip-detail="date"]');
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    dateField.min = localDate;
    if (dateField.value && dateField.value < localDate) { dateField.value = ''; storage.set('date', ''); }
  }

  function syncLiftType(side, clearWhenHidden = false) {
    const checkbox = document.querySelector(`[data-trip-detail="${side}Lift"]`);
    const select = document.querySelector(`[data-trip-detail="${side}LiftType"]`);
    const panel = select.closest('.lift-type-panel');
    panel.hidden = !checkbox.checked;
    select.disabled = !checkbox.checked;
    if (!checkbox.checked && clearWhenHidden) {
      select.value = '';
      storage.set(`${side}LiftType`, '');
      renderEstimate();
    }
  }

  function hydrateTripDetails() {
    for (const field of tripFields) {
      let saved = storage.get(field.dataset.tripDetail);
      if (field.dataset.tripDetail === 'helpers' && Number(saved) > 3) {
        saved = '3';
        storage.set('helpers', saved);
      }
      if (saved !== null) field.type === 'checkbox' ? field.checked = saved === 'true' : field.value = saved;
      field.addEventListener('input', () => {
        storage.set(field.dataset.tripDetail, field.type === 'checkbox' ? String(field.checked) : field.value);
        renderEstimate();
      });
      field.addEventListener('change', () => {
        storage.set(field.dataset.tripDetail, field.type === 'checkbox' ? String(field.checked) : field.value);
        renderEstimate();
      });
      if (field.dataset.tripDetail === 'fromLift' || field.dataset.tripDetail === 'toLift') {
        const side = field.dataset.tripDetail === 'fromLift' ? 'from' : 'to';
        field.addEventListener('change', () => syncLiftType(side, true));
      }
    }
    syncLiftType('from', true);
    syncLiftType('to', true);
    setDateMinimum();
  }

  for (const key of ['from', 'to']) {
    inputs[key].addEventListener('input', () => {
      routeToken++;
      routeDistanceMeters = null; routeLegs = null;
      if (routeLine && map) { map.removeLayer(routeLine); routeLine = null; }
      renderEstimate();
      clearTimeout(searchTimers[key]);
      const query = inputs[key].value.trim();
      if (query.length < 2) { suggestions[key].classList.remove('open'); return; }
      searchTimers[key] = setTimeout(async () => {
        try { showSuggestions(key, await geocodePhoton(query)); }
        catch { suggestions[key].classList.remove('open'); }
      }, 450);
    });
    inputs[key].addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); resolveInput(key); }
      if (event.key === 'Escape') suggestions[key].classList.remove('open');
    });
    inputs[key].addEventListener('blur', () => setTimeout(() => suggestions[key].classList.remove('open'), 180));
    inputs[key].closest('.field').querySelector('.clear-input').addEventListener('click', () => {
      inputs[key].value = ''; inputs[key].dispatchEvent(new Event('input')); inputs[key].focus(); suggestions[key].classList.remove('open');
    });
  }

  nextRouteButton.addEventListener('click', async () => {
    for (const key of ['from', 'to']) {
      if (!await resolveInput(key)) return;
    }
    if (samePoint(points.from, points.to)) {
      setRouteStatus('Точки отправления и доставки совпадают. Укажите разные адреса.', 'error');
      return;
    }
    if (routeDistanceMeters === null) {
      setRouteStatus('Дождитесь построения маршрута по дорогам или выберите другие точки.', 'error');
      return;
    }
    showStep(2);
  });

  document.querySelectorAll('[data-prev]').forEach(button => button.addEventListener('click', () => showStep(currentStep - 1)));
  document.querySelector('#nextToEstimate').addEventListener('click', () => {
    for (const side of ['from', 'to']) {
      const checkbox = document.querySelector(`[data-trip-detail="${side}Lift"]`);
      const type = document.querySelector(`[data-trip-detail="${side}LiftType"]`);
      if (checkbox.checked && !type.value) {
        type.setCustomValidity('Выберите тип лифта.');
        type.reportValidity();
        return;
      }
      type.setCustomValidity('');
    }
    const dateField = document.querySelector('[data-trip-detail="date"]');
    if (dateField.value && dateField.value < dateField.min) {
      dateField.setCustomValidity('Выберите сегодняшнюю или будущую дату.');
      dateField.reportValidity();
      return;
    }
    dateField.setCustomValidity('');
    renderEstimate();
    showStep(3);
  });
  document.querySelector('#editRoute').addEventListener('click', () => showStep(1));
  document.querySelector('#swapRoute').addEventListener('click', () => {
    const a = { ...points.from }, b = { ...points.to };
    setPoint('from', b); setPoint('to', a, true); clickNext = 'from';
  });
  document.querySelector('#locateMe').addEventListener('click', () => {
    if (!navigator.geolocation) return setRouteStatus('Браузер не поддерживает определение геопозиции.', 'error');
    navigator.geolocation.getCurrentPosition(position => {
      const p = position.coords;
      const key = clickNext;
      setPoint(key, { name: 'Моя геопозиция', lat: p.latitude, lon: p.longitude }, true);
      clickNext = key === 'from' ? 'to' : 'from';
    }, error => {
      const message = error.code === 1 ? 'Доступ к геопозиции запрещён. Введите адрес вручную или выберите точку на карте.' : 'Не удалось определить геопозицию. Введите адрес вручную или выберите точку на карте.';
      setRouteStatus(message, 'error');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
  document.querySelector('.menu-toggle').addEventListener('click', () => document.querySelector('.nav').classList.toggle('open'));
  document.querySelectorAll('.nav a').forEach(link => link.addEventListener('click', () => document.querySelector('.nav').classList.remove('open')));

  document.querySelector('#copyQuote').addEventListener('click', async () => {
    const message = createMaxMessage();
    const status = document.querySelector('#copyStatus');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(message);
      else {
        const buffer = document.createElement('textarea'); buffer.value = message;
        buffer.style.cssText = 'position:fixed;opacity:0'; document.body.append(buffer); buffer.select();
        const copied = document.execCommand('copy'); buffer.remove(); if (!copied) throw new Error('copy failed');
      }
      status.textContent = 'Скопировано — вставьте в выбранный мессенджер';
    } catch {
      showStep(3); const preview = document.querySelector('#messagePreview'); preview.value = message; preview.focus(); preview.select();
      status.textContent = 'Выделили текст — скопируйте его вручную';
    }
  });
  let sceneFrame = 0;
  function paintScene() {
    sceneFrame = 0;
    const progress = Math.min(1, window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight));
    document.documentElement.style.setProperty('--page-progress', progress.toFixed(4));
    const sceneDrift = -Math.min(window.scrollY * .09, 85);
    document.documentElement.style.setProperty('--scene-drift', `${sceneDrift}px`);
    document.documentElement.style.setProperty('--car-shift', `${sceneDrift}px`);
  }
  window.addEventListener('scroll', () => { if (!sceneFrame) sceneFrame = requestAnimationFrame(paintScene); }, {passive:true});
  paintScene();

  hydrateTripDetails();
  renderEstimate();
  if (document.readyState === 'complete') initMap();
  else window.addEventListener('load', initMap, { once: true });
})();

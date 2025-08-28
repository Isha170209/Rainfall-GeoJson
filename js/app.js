// dashboard/js/app.js
(async function () {
  const dataBase = 'data/';
  const manifestUrl = dataBase + 'manifest.json';
  const latestFallback = dataBase + 'latest.geojson';
  const cacheBust = '?_=' + Date.now();

  // IMD grid constants
  const GRID_LAT_MIN = 6.5;
  const GRID_LAT_MAX = 38.5;
  const GRID_LON_MIN = 66.5;
  const GRID_LON_MAX = 100.0;
  const CELL_SIZE = 0.25;

  // Leaflet map
  const map = L.map('map').setView([22.5, 79], 5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // Layers
  let gridLayer = L.layerGroup().addTo(map);   // grid (default visible)
  let markersLayer = L.layerGroup();           // circles added only when toggled
  let markerToggle = null;                     // checkbox reference (set later)

  // UI elements
  const stateFilter    = document.getElementById('stateFilter');
  const districtFilter = document.getElementById('districtFilter');
  const tehsilFilter   = document.getElementById('tehsilFilter');
  const dateFilter     = document.getElementById('dateFilter');

  // Data
  let baseData = null;
  let allPoints = [];

  // Colors & radius helpers
  function colorForRain(mm) {
    if (mm === null || isNaN(mm)) return '#cccccc';
    if (mm === 0) return '#f7fbff';
    if (mm < 10)  return '#deebf7';
    if (mm < 30)  return '#c6dbef';
    if (mm < 50)  return '#9ecae1';
    if (mm < 80)  return '#6baed6';
    if (mm < 100) return '#4292c6';
    if (mm < 150) return '#2171b5';
    return '#08306b';
  }
  function radiusForRain(mm) {
    if (mm === null || isNaN(mm)) return 4;
    return Math.min(18, 4 + Math.sqrt(mm));
  }

  // Snap raw lat/lon to IMD grid center
  function snapToGrid(lat, lon) {
    if (lat < GRID_LAT_MIN || lat > GRID_LAT_MAX || lon < GRID_LON_MIN || lon > GRID_LON_MAX) {
      return null;
    }
    const iLat = Math.round((lat - GRID_LAT_MIN) / CELL_SIZE);
    const iLon = Math.round((lon - GRID_LON_MIN) / CELL_SIZE);
    const snappedLat = GRID_LAT_MIN + iLat * CELL_SIZE;
    const snappedLon = GRID_LON_MIN + iLon * CELL_SIZE;
    return [Number(snappedLat.toFixed(6)), Number(snappedLon.toFixed(6))];
  }

  // Load base data
  async function loadBaseData() {
    try {
      const res = await fetch(manifestUrl + cacheBust);
      if (res.ok) {
        const m = await res.json();
        const url = dataBase + (m.latest || 'latest.geojson');
        const g = await fetch(url + '?cache=' + Date.now());
        if (g.ok) {
          baseData = await g.json();
          return;
        }
      }
    } catch (e) {}
    const fb = await fetch(latestFallback + '?cache=' + Date.now());
    if (!fb.ok) throw new Error('Failed to load fallback geojson');
    baseData = await fb.json();
  }

  // Ingest GeoJSON
  function ingestData(gjson) {
    const points = [];
    const states = new Set();
    const districts = new Set();
    const tehsils = new Set();
    const mapStateToDistricts = new Map();
    const mapStateDistToTehsils = new Map();

    (gjson.features || []).forEach(f => {
      const coords = f.geometry?.coordinates;
      const p = coords ? [coords[1], coords[0]] : null;
      const props = f.properties || {};
      const rain = parseFloat(props.Rainfall);
      const state    = (props.State || '').trim();
      const district = (props.District || '').trim();
      const tehsil   = (props.Tehsil || '').trim();
      const date     = (props.Date || '').trim();

      states.add(state);
      districts.add(district);
      tehsils.add(tehsil);

      if (!mapStateToDistricts.has(state)) mapStateToDistricts.set(state, new Set());
      mapStateToDistricts.get(state).add(district);

      const sdKey = `${state}||${district}`;
      if (!mapStateDistToTehsils.has(sdKey)) mapStateDistToTehsils.set(sdKey, new Set());
      mapStateDistToTehsils.get(sdKey).add(tehsil);

      points.push({ latlng: p, props, rain, state, district, tehsil, date });
    });

    return { points, states, districts, tehsils, mapStateToDistricts, mapStateDistToTehsils };
  }

  // Populate select dropdown
  function populateSelect(selectEl, items, placeholderText) {
    const current = selectEl.value;
    selectEl.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = placeholderText || 'All';
    selectEl.appendChild(opt0);
    items.forEach(val => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      selectEl.appendChild(opt);
    });
    if ([...items].includes(current)) selectEl.value = current;
  }

  // Core rendering
  function renderData(points) {
    markersLayer.clearLayers();
    gridLayer.clearLayers();

    // Build dictionary of grid cells that actually contain filtered data
    const cellData = new Map();
    (points || []).forEach(pt => {
      if (!pt.latlng) return;
      const snapped = snapToGrid(pt.latlng[0], pt.latlng[1]);
      if (!snapped) return;
      const key = `${snapped[0].toFixed(6)}|${snapped[1].toFixed(6)}`;
      cellData.set(key, { center: snapped, point: pt });
    });

    // Only draw cells that have data
    for (const [key, data] of cellData.entries()) {
      const [cLat, cLon] = data.center;
      const bounds = [
        [cLat - CELL_SIZE / 2, cLon - CELL_SIZE / 2],
        [cLat + CELL_SIZE / 2, cLon + CELL_SIZE / 2]
      ];

      const fillColor = colorForRain(data.point.rain);

      const rect = L.rectangle(bounds, {
        color: '#555',
        weight: 0.6,
        fillColor,
        fillOpacity: 0.25,
        dashArray: '2,4'
      }).bindPopup(`
        <b>State:</b> ${data.point.state || 'N/A'}<br/>
        <b>District:</b> ${data.point.district || 'N/A'}<br/>
        <b>Tehsil:</b> ${data.point.tehsil || 'N/A'}<br/>
        <b>Date:</b> ${data.point.date || 'N/A'}<br/>
        <b>Rainfall:</b> ${isNaN(data.point.rain) ? 'N/A' : data.point.rain + ' mm'}<br/>
        <b>Cell center:</b> ${cLat.toFixed(4)}, ${cLon.toFixed(4)}
      `);

      gridLayer.addLayer(rect);

      // Circles when toggled
      if (markerToggle && markerToggle.checked) {
        const circle = L.circleMarker([cLat, cLon], {
          radius: radiusForRain(data.point.rain),
          fillColor: fillColor,
          color: '#222',
          weight: 0.6,
          fillOpacity: 0.85
        }).bindPopup(`
          <b>State:</b> ${data.point.state || 'N/A'}<br/>
          <b>District:</b> ${data.point.district || 'N/A'}<br/>
          <b>Tehsil:</b> ${data.point.tehsil || 'N/A'}<br/>
          <b>Date:</b> ${data.point.date || 'N/A'}<br/>
          <b>Rainfall:</b> ${isNaN(data.point.rain) ? 'N/A' : data.point.rain + ' mm'}<br/>
          <b>Point (grid center):</b> ${cLat.toFixed(4)}, ${cLon.toFixed(4)}
        `);
        markersLayer.addLayer(circle);
      }
    }

    // Toggle marker layer
    const showCircles = !!(markerToggle && markerToggle.checked);
    if (showCircles) {
      if (!map.hasLayer(markersLayer)) markersLayer.addTo(map);
    } else {
      if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
    }

    // Autozoom
    const targetLayer = (showCircles && markersLayer.getLayers().length) ? markersLayer : gridLayer;
    if (targetLayer.getLayers().length) {
      const bounds = targetLayer.getBounds().pad(0.2);
      if (bounds.isValid()) map.flyToBounds(bounds, { padding: [50, 50], duration: 1.2 });
    }
  }

  // Filtering helper
  function filteredPoints() {
    const s = stateFilter.value.trim();
    const d = districtFilter.value.trim();
    const t = tehsilFilter.value.trim();
    const date = dateFilter.value.trim();
    return allPoints.filter(p => {
      if (s && p.state !== s) return false;
      if (d && p.district !== d) return false;
      if (t && p.tehsil !== t) return false;
      if (date && p.date !== date) return false;
      return true;
    });
  }

  // Cascade setup
  function setupCascading(lookups) {
    stateFilter.onchange = () => {
      const s = stateFilter.value;
      if (s && lookups.mapStateToDistricts.has(s)) {
        populateSelect(districtFilter, [...lookups.mapStateToDistricts.get(s)].sort(), 'All Districts');
      } else {
        populateSelect(districtFilter, [...lookups.districts].sort(), 'All Districts');
      }
      districtFilter.onchange();
      renderData(filteredPoints());
    };
    districtFilter.onchange = () => {
      const s = stateFilter.value;
      const d = districtFilter.value;
      const key = `${s}||${d}`;
      if (s && d && lookups.mapStateDistToTehsils.has(key)) {
        populateSelect(tehsilFilter, [...lookups.mapStateDistToTehsils.get(key)].sort(), 'All Tehsils');
      } else if (s && !d) {
        const tehs = new Set();
        (lookups.mapStateToDistricts.get(s) || []).forEach(dd => {
          const k = `${s}||${dd}`; (lookups.mapStateDistToTehsils.get(k) || []).forEach(t => tehs.add(t));
        });
        populateSelect(tehsilFilter, [...tehs].sort(), 'All Tehsils');
      } else {
        populateSelect(tehsilFilter, [...lookups.tehsils].sort(), 'All Tehsils');
      }
      renderData(filteredPoints());
    };
    tehsilFilter.onchange = () => renderData(filteredPoints());
    dateFilter.onchange = () => renderData(filteredPoints());
    if (markerToggle) markerToggle.onchange = () => renderData(filteredPoints());
  }

  // Legend
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend');
    div.id = 'legend';
    const title = document.createElement('div');
    title.innerHTML = '<strong>Legend</strong>';
    title.style.textAlign = 'center';
    title.style.marginBottom = '6px';
    div.appendChild(title);
    const labels = [
      '0 mm', '<10 mm', '10–30 mm', '30–50 mm', '50–80 mm',
      '80–100 mm', '100–150 mm', '>150 mm'
    ];
    const colors = [
      '#f7fbff', '#deebf7', '#c6dbef', '#9ecae1',
      '#6baed6', '#4292c6', '#2171b5', '#08306b'
    ];
    labels.forEach((l, i) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-color" style="background:${colors[i]}"></span>${l}`;
      div.appendChild(item);
    });
    return div;
  };
  legend.addTo(map);

  // Coordinate box
  const coordControl = L.control({ position: 'bottomleft' });
  coordControl.onAdd = function () {
    const div = L.DomUtil.create('div', 'coord-box');
    div.id = 'coordBox';
    div.innerHTML = `
      <div style="font-weight:bold; margin-bottom:4px; text-align:center;">
        Click on map to get coordinates
      </div>
      <div id="coordContent" style="text-align:center; font-size:13px; color:#333;">—</div>
    `;
    return div;
  };
  coordControl.addTo(map);
  map.on('click', function (e) {
    const lat = e.latlng.lat.toFixed(4);
    const lon = e.latlng.lng.toFixed(4);
    const el = document.getElementById('coordContent');
    if (el) el.textContent = `Lat: ${lat}, Lon: ${lon}`;
  });

  // Marker toggle
  const markerControl = L.control({ position: 'topright' });
  markerControl.onAdd = function () {
    const div = L.DomUtil.create('div', 'leaflet-bar grid-toggle-control');
    div.style.background = '#fff';
    div.style.padding = '8px';
    div.style.borderRadius = '6px';
    div.style.boxShadow = '0 0 4px rgba(0,0,0,0.3)';
    div.style.fontSize = '13px';
    const title = document.createElement('div');
    title.className = 'grid-toggle-title';
    title.textContent = 'Rainfall Data Points';
    div.appendChild(title);
    const line = document.createElement('label');
    markerToggle = document.createElement('input');
    markerToggle.type = 'checkbox';
    markerToggle.id = 'markerToggle';
    markerToggle.style.marginRight = '6px';
    const labelText = document.createElement('span');
    labelText.textContent = 'Show Circles';
    line.appendChild(markerToggle);
    line.appendChild(labelText);
    div.appendChild(line);
    L.DomEvent.disableClickPropagation(div);
    markerToggle.onchange = () => renderData(filteredPoints());
    return div;
  };
  markerControl.addTo(map);

  // INITIAL LOAD
  await loadBaseData();
  const baseLookups = ingestData(baseData);
  allPoints = baseLookups.points;

  populateSelect(stateFilter,   [...baseLookups.states].sort(), 'All States');
  populateSelect(districtFilter,[...baseLookups.districts].sort(), 'All Districts');
  populateSelect(tehsilFilter,  [...baseLookups.tehsils].sort(), 'All Tehsils');

  setupCascading(baseLookups);
  renderData(allPoints);
})();

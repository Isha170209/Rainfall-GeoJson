// dashboard/js/app.js
(async function () {
  const dataBase = 'data/';
  const manifestUrl = dataBase + 'manifest.json';
  const latestFallback = dataBase + 'latest.geojson';
  const cacheBust = '?_=' + Date.now();

  // Leaflet map
  const map = L.map('map').setView([22.5, 79], 5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // NEW: layer for grid rectangles
  let gridLayer = L.layerGroup().addTo(map);

  // UI
  const stateFilter   = document.getElementById('stateFilter');
  const districtFilter= document.getElementById('districtFilter');
  const tehsilFilter  = document.getElementById('tehsilFilter');
  const dateFilter    = document.getElementById('dateFilter');

  // Layers / data
  let baseData = null;         
  let allPoints = [];          
  let markersLayer = L.layerGroup().addTo(map);

  // Colors: 8 categories
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

  // Ingest GeoJSON → lookups + points
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
      const state   = (props.State || '').trim();
      const district= (props.District || '').trim();
      const tehsil  = (props.Tehsil || '').trim();
      const date    = (props.Date || '').trim();

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

  // Populate dropdown
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

  // Render points (autozoom enabled)
  function renderMarkers(points) {
    markersLayer.clearLayers();
    gridLayer.clearLayers(); //  clear old grid

    points.forEach(pt => {
      if (!pt.latlng) return;

      // Circle marker
      const circle = L.circleMarker(pt.latlng, {
        radius: radiusForRain(pt.rain),
        fillColor: colorForRain(pt.rain),
        color: '#222',
        weight: 0.6,
        fillOpacity: 0.85
      }).bindPopup(`
        <b>State:</b> ${pt.state || 'N/A'}<br/>
        <b>District:</b> ${pt.district || 'N/A'}<br/>
        <b>Tehsil:</b> ${pt.tehsil || 'N/A'}<br/>
        <b>Date:</b> ${pt.date || 'N/A'}<br/>
        <b>Rainfall:</b> ${isNaN(pt.rain) ? 'N/A' : pt.rain + ' mm'}<br/>
        <b>Lat:</b> ${pt.latlng[0].toFixed(4)}<br/>
        <b>Lon:</b> ${pt.latlng[1].toFixed(4)}
      `);
      markersLayer.addLayer(circle);

      // Grid cell centered at point
      if (gridToggle.checked) {
        const cellSize = 0.25;
        const lat = pt.latlng[0];
        const lon = pt.latlng[1];
        const bounds = [
          [lat - cellSize / 2, lon - cellSize / 2],
          [lat + cellSize / 2, lon + cellSize / 2]
        ];
        const rect = L.rectangle(bounds, {
          color: '#555',
          weight: 0.7,
          fillOpacity: 0,
          dashArray: "4"
        });
        gridLayer.addLayer(rect);
      }
    });

    if (markersLayer.getLayers().length) {
      const bounds = markersLayer.getBounds().pad(0.2);
      if (bounds.isValid()) {
        map.flyToBounds(bounds, { padding: [50, 50], duration: 1.5 });
      }
    }
  }

  // Filtering
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

  // Cascade
  function setupCascading(lookups) {
    stateFilter.onchange = () => {
      const s = stateFilter.value;
      if (s && lookups.mapStateToDistricts.has(s)) {
        populateSelect(districtFilter, [...lookups.mapStateToDistricts.get(s)].sort(), 'All Districts');
      } else {
        populateSelect(districtFilter, [...lookups.districts].sort(), 'All Districts');
      }
      districtFilter.onchange();
      renderMarkers(filteredPoints());
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
          const k = `${s}||${dd}`;
          (lookups.mapStateDistToTehsils.get(k) || []).forEach(t => tehs.add(t));
        });
        populateSelect(tehsilFilter, [...tehs].sort(), 'All Tehsils');
      } else {
        populateSelect(tehsilFilter, [...lookups.tehsils].sort(), 'All Tehsils');
      }
      renderMarkers(filteredPoints());
    };

    tehsilFilter.onchange = () => {
      renderMarkers(filteredPoints());
    };
    dateFilter.onchange = () => {
      renderMarkers(filteredPoints());
    };
    // toggle grid re-render
    gridToggle.onchange = () => {
      renderMarkers(filteredPoints());
    };
  }

  // Legend
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend');
    div.id = 'legend';

    // Add title here
    const title = document.createElement('div');
    title.innerHTML = "<strong>Legend</strong>";
    title.style.textAlign = "center";
    title.style.marginBottom = "6px";
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

  // NEW: Grid toggle as Leaflet control
  let gridToggle;
  const gridControl = L.control({ position: "topright" });
  gridControl.onAdd = function () {
    const div = L.DomUtil.create("div", "leaflet-bar");
    div.style.background = "#fff";
    div.style.padding = "8px";
    div.style.borderRadius = "6px";
    div.style.boxShadow = "0 0 4px rgba(0,0,0,0.3)";
    div.style.fontSize = "13px";

    const title = document.createElement("div");
    title.innerHTML = "<b>0.25° x 0.25°<br/>Resolution Grid</b>";
    title.style.textAlign = "center";
    title.style.marginBottom = "6px";
    div.appendChild(title);

    gridToggle = document.createElement("input");
    gridToggle.type = "checkbox";
    gridToggle.id = "gridToggle";

    const label = document.createElement("label");
    label.setAttribute("for", "gridToggle");
    label.textContent = " Show Grid";
    label.style.marginLeft = "4px";

    const line = document.createElement("div");
    line.appendChild(gridToggle);
    line.appendChild(label);
    div.appendChild(line);

    return div;
  };
  gridControl.addTo(map);

  // === INITIAL LOAD ===
  await loadBaseData();
  const baseLookups = ingestData(baseData);
  allPoints = baseLookups.points;
  populateSelect(stateFilter, [...baseLookups.states].sort(), 'All States');
  populateSelect(districtFilter, [...baseLookups.districts].sort(), 'All Districts');
  populateSelect(tehsilFilter, [...baseLookups.tehsils].sort(), 'All Tehsils');
  setupCascading(baseLookups);
  renderMarkers(allPoints);
})();

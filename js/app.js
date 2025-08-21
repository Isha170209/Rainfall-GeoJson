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

  // UI
  const stateFilter   = document.getElementById('stateFilter');
  const districtFilter= document.getElementById('districtFilter');
  const tehsilFilter  = document.getElementById('tehsilFilter');
  const dateFilter    = document.getElementById('dateFilter');
  const submitBtn     = document.getElementById('submitBtn');
  const resetBtn      = document.getElementById('resetBtn');

  // Layers / data
  let baseData = null;          // the initially loaded file (latest or from manifest)
  let workingData = null;       // data used for the current submit (may be a date file)
  let allPoints = [];           // flattened points for workingData
  let markersLayer = L.layerGroup().addTo(map);

  // Colors: 8 categories (0, <10, 10–30, 30–50, 50–80, 80–100, 100–150, >150)
  function colorForRain(mm) {
    if (mm === null || isNaN(mm)) return '#cccccc';
    if (mm === 0) return '#f7fbff';     // 0
    if (mm < 10)  return '#deebf7';     // <10
    if (mm < 30)  return '#c6dbef';     // 10–30
    if (mm < 50)  return '#9ecae1';     // 30–50
    if (mm < 80)  return '#6baed6';     // 50–80
    if (mm < 100) return '#4292c6';     // 80–100
    if (mm < 150) return '#2171b5';     // 100–150
    return '#08306b';                   // >150
  }

  function radiusForRain(mm) {
    if (mm === null || isNaN(mm)) return 4;
    return Math.min(18, 4 + Math.sqrt(mm));
  }

  // Load base data (latest or manifest)
  async function loadBaseData() {
    try {
      const res = await fetch(manifestUrl + cacheBust);
      if (res.ok) {
        const m = await res.json();
        const url = dataBase + (m.latest || 'latest.geojson');
        const g = await fetch(url + (url.includes('?') ? '&' : '?') + 'cache=' + Date.now());
        if (!g.ok) throw new Error('Failed to load manifest latest.');
        baseData = await g.json();
        return;
      }
    } catch (e) { /* ignore */ }

    // fallback
    const fb = await fetch(latestFallback + (latestFallback.includes('?') ? '&' : '?') + 'cache=' + Date.now());
    if (!fb.ok) throw new Error('Failed to load fallback geojson');
    baseData = await fb.json();
  }

  // Build point list + lookup structures from a GeoJSON
  function ingestData(gjson) {
    const points = [];
    const states = new Set();
    const districts = new Set();
    const tehsils = new Set();

    // cascading lookup
    const mapStateToDistricts = new Map();              // state => Set(district)
    const mapStateDistToTehsils = new Map();            // `${state}||${district}` => Set(tehsil)

    (gjson.features || []).forEach(f => {
      const coords = f.geometry && f.geometry.coordinates;
      const p = coords ? [coords[1], coords[0]] : null;
      const props = f.properties || {};
      const rain = parseFloat(props.Rainfall);
      const state   = (props.State   || '').trim();
      const district= (props.District|| '').trim();
      const tehsil  = (props.Tehsil  || '').trim();
      const date    = (props.Date    || '').trim();

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

  // Populate a select
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
    // keep selection if still present
    if ([...items].includes(current)) selectEl.value = current;
  }

  // Render markers for a given set of points
  function renderMarkers(points) {
    markersLayer.clearLayers();

    points.forEach(pt => {
      if (!pt.latlng) return;
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
        <b>Date:</b> ${pt.date || pt.props?.Date || 'N/A'}<br/>
        <b>Rainfall:</b> ${isNaN(pt.rain) ? 'N/A' : pt.rain + ' mm'}<br/>
        <b>Lat:</b> ${pt.latlng[0].toFixed(4)}<br/>
        <b>Lon:</b> ${pt.latlng[1].toFixed(4)}
      `);
      markersLayer.addLayer(circle);
    });

    if (markersLayer.getLayers().length) {
      map.fitBounds(markersLayer.getBounds().pad(0.2));
    }
  }

  // Apply current UI filters to allPoints
  function filteredPoints() {
    const s = (stateFilter.value || '').trim();
    const d = (districtFilter.value || '').trim();
    const t = (tehsilFilter.value || '').trim();
    const date = (dateFilter.value || '').trim(); // YYYY-MM-DD

    return allPoints.filter(p => {
      if (s && p.state !== s) return false;
      if (d && p.district !== d) return false;
      if (t && p.tehsil !== t) return false;
      if (date && p.date !== date) return false;
      return true;
    });
  }

  // Try to load a dated file; fallback to filtering the current baseData
  async function getWorkingDataForSubmit() {
    const selectedDate = (dateFilter.value || '').trim();
    if (!selectedDate) return baseData;

    const datedUrl = `${dataBase}${selectedDate}.geojson`;
    try {
      const res = await fetch(datedUrl + '?cache=' + Date.now());
      if (res.ok) {
        return await res.json();
      }
    } catch (e) { /* ignore */ }
    // fallback to baseData if dated file not found
    return baseData;
  }

  // Cascade: when state changes, update districts & tehsils (no map update yet)
  function setupCascading(lookups) {
    stateFilter.onchange = () => {
      const s = stateFilter.value;
      // update districts
      if (s && lookups.mapStateToDistricts.has(s)) {
        populateSelect(districtFilter, [...lookups.mapStateToDistricts.get(s)].sort(), 'All Districts');
      } else {
        populateSelect(districtFilter, [...lookups.districts].sort(), 'All Districts');
      }
      // update tehsils based on (s, d)
      const d = districtFilter.value;
      const key = `${s}||${d}`;
      if (s && d && lookups.mapStateDistToTehsils.has(key)) {
        populateSelect(tehsilFilter, [...lookups.mapStateDistToTehsils.get(key)].sort(), 'All Tehsils');
      } else if (s && !d) {
        // gather all tehsils under state
        const tehs = new Set();
        (lookups.mapStateToDistricts.get(s) || []).forEach(dd => {
          const k = `${s}||${dd}`;
          (lookups.mapStateDistToTehsils.get(k) || []).forEach(t => tehs.add(t));
        });
        populateSelect(tehsilFilter, [...tehs].sort(), 'All Tehsils');
      } else {
        populateSelect(tehsilFilter, [...lookups.tehsils].sort(), 'All Tehsils');
      }
    };

    districtFilter.onchange = () => {
      const s = stateFilter.value;
      const d = districtFilter.value;
      const key = `${s}||${d}`;
      if (s && d && lookups.mapStateDistToTehsils.has(key)) {
        populateSelect(tehsilFilter, [...lookups.mapStateDistToTehsils.get(key)].sort(), 'All Tehsils');
      } else if (s && !d) {
        // state chosen, district cleared: gather all tehsils in state
        const tehs = new Set();
        (lookups.mapStateToDistricts.get(s) || []).forEach(dd => {
          const k = `${s}||${dd}`;
          (lookups.mapStateDistToTehsils.get(k) || []).forEach(t => tehs.add(t));
        });
        populateSelect(tehsilFilter, [...tehs].sort(), 'All Tehsils');
      } else {
        populateSelect(tehsilFilter, [...lookups.tehsils].sort(), 'All Tehsils');
      }
    };
  }

  // ===== Legend (8 bins) =====
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend');
    div.id = 'legend';
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

  // ===== Initial load =====
  await loadBaseData();

  // Ingest base data and populate initial selects (full universe)
  const baseLookups = ingestData(baseData);
  allPoints = baseLookups.points;

  populateSelect(stateFilter,   [...baseLookups.states].sort(),   'All States');
  populateSelect(districtFilter,[...baseLookups.districts].sort(),'All Districts');
  populateSelect(tehsilFilter,  [...baseLookups.tehsils].sort(),  'All Tehsils');

  setupCascading(baseLookups);

  // Draw all points by default
  renderMarkers(allPoints);

  // ===== Submit: load date file if available, then filter & render =====
  submitBtn.onclick = async () => {
    // Load workingData (date file or base)
    workingData = await getWorkingDataForSubmit();

    // Build points & lookups for workingData (to ensure dropdowns reflect actual available values)
    const lk = ingestData(workingData);
    allPoints = lk.points;

    // IMPORTANT: preserve current selections, but repopulate to actual available options
    populateSelect(stateFilter,   [...lk.states].sort(),   'All States');
    populateSelect(districtFilter,[...lk.districts].sort(),'All Districts');
    populateSelect(tehsilFilter,  [...lk.tehsils].sort(),  'All Tehsils');

    setupCascading(lk); // ensure cascade reflects working set

    // Apply current selections to the points (state/district/tehsil/date)
    const pts = filteredPoints();
    renderMarkers(pts);

    if (!pts.length) {
      // If nothing matched, zoom to India extents as fallback
      map.setView([22.5, 79], 5);
      alert('No points match the current filters.');
    }
  };

  // ===== Reset: clear filters, show everything from baseData =====
  resetBtn.onclick = async () => {
    // clear UI
    stateFilter.value = '';
    districtFilter.value = '';
    tehsilFilter.value = '';
    dateFilter.value = '';

    // revert to base data universe
    const lk = ingestData(baseData);
    allPoints = lk.points;

    populateSelect(stateFilter,   [...lk.states].sort(),   'All States');
    populateSelect(districtFilter,[...lk.districts].sort(),'All Districts');
    populateSelect(tehsilFilter,  [...lk.tehsils].sort(),  'All Tehsils');

    setupCascading(lk);

    renderMarkers(allPoints);
  };
})();

// dashboard/js/app.js
(async function(){
  const dataBase = 'data/';
  const manifestUrl = dataBase + 'manifest.json';
  const latestFallback = dataBase + 'latest.geojson';
  const cacheBust = '?_=' + Date.now();

  // Setup map
  const map = L.map('map').setView([22.5, 79], 5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // UI elements
  const stateFilter = document.getElementById('stateFilter');
  const districtFilter = document.getElementById('districtFilter');
  const dateFilter = document.getElementById('dateFilter');
  const resetBtn = document.getElementById('resetBtn');
  const fileLabel = document.getElementById('fileLabel');
  const chartCtx = document.getElementById('chart').getContext('2d');
  const topList = document.getElementById('topList');

  // create submit button dynamically
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit';
  submitBtn.style.marginLeft = '8px';
  submitBtn.id = 'submitBtn';
  document.getElementById('controls').appendChild(submitBtn);
  resetBtn.style.marginLeft = '4px'; // adjust spacing

  let geojsonData = null;
  let originalData = null; // store original data for reset
  let markersLayer = L.layerGroup().addTo(map);

  // color scale by rainfall (mm)
  const colorScale = [
    {limit: 0, color:'#f7fbff'},
    {limit: 5, color:'#c6dbef'},
    {limit: 20, color:'#6baed6'},
    {limit: 50, color:'#2171b5'},
    {limit: 100, color:'#08519c'},
    {limit: Infinity, color:'#08306b'}
  ];

  function colorForRain(mm){
    if (mm === null || isNaN(mm)) return '#ccc';
    for(let i=0; i<colorScale.length; i++){
      if(mm < colorScale[i].limit) return colorScale[i].color;
    }
    return '#08306b';
  }

  function radiusForRain(mm){
    if (mm === null || isNaN(mm)) return 4;
    return Math.min(18, 4 + Math.sqrt(mm));
  }

  // load specific date file
  async function loadDataForDate(isoDate) {
    const url = dataBase + isoDate + ".geojson";
    try {
      const res = await fetch(url + "?cache=" + Date.now());
      if (!res.ok) throw new Error("No data for " + isoDate);
      const gjson = await res.json();
      geojsonData = gjson;
      originalData = gjson; // store original
      renderData(geojsonData);
    } catch (err) {
      console.warn(err);
    }
  }

  // default load: use manifest or latest.geojson
  async function loadData(){
    try {
      const mres = await fetch(manifestUrl + cacheBust);
      if (mres.ok){
        const m = await mres.json();
        const url = dataBase + (m.latest || 'latest.geojson');
        return {url, meta: m};
      }
    } catch(e){ /* no manifest */ }
    return {url: latestFallback + cacheBust};
  }

  const {url} = await loadData();
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cache=' + Date.now());
    if (!res.ok) throw new Error('Failed to load geojson');
    geojsonData = await res.json();
    originalData = geojsonData; // store original for reset
    renderData(geojsonData);
  } catch(err){
    console.error(err);
  }

  // render data on map, chart, and top list
  function renderData(gjson){
    markersLayer.clearLayers();
    const states = new Set(), districts = new Set();
    const points = [];

    gjson.features.forEach(f => {
      const p = f.geometry && f.geometry.coordinates ? [f.geometry.coordinates[1], f.geometry.coordinates[0]] : null;
      const props = f.properties || {};
      const rain = parseFloat(props.Rainfall);
      const state = props.State || props.state || '';
      const district = props.District || props.district || '';
      states.add(state); districts.add(district);
      points.push({latlng: p, props, rain, state, district});
    });

    // populate dropdowns
    populateSelect(stateFilter, ['', ...Array.from(states).sort()]);
    populateSelect(districtFilter, ['', ...Array.from(districts).sort()]);

    // draw markers
    points.forEach(pt => {
      if(!pt.latlng) return;
      const circle = L.circleMarker(pt.latlng, {
        radius: radiusForRain(pt.rain),
        fillColor: colorForRain(pt.rain),
        color: '#222',
        weight: 0.6,
        fillOpacity: 0.8
      }).bindPopup(`<b>${pt.props.State || ''} / ${pt.props.District || ''} / ${pt.props.Tehsil || ''}</b><br>
                    Date: ${pt.props.Date || ''}<br>
                    Rainfall: ${pt.props.Rainfall} mm`);
      circle.feature = pt; // store for filtering
      markersLayer.addLayer(circle);
    });

    // fit to markers
    if (markersLayer.getLayers().length) {
      map.fitBounds(markersLayer.getBounds().pad(0.2));
    }

    // show top chart & list
    showTopChart(points);
  }

  function populateSelect(selectEl, items){
    selectEl.innerHTML = '';
    items.forEach(i => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.text = i || 'All';
      selectEl.appendChild(opt);
    });
  }

  function showTopChart(points){
    const sorted = points.filter(p => !isNaN(p.rain)).sort((a,b)=> b.rain - a.rain).slice(0,20);
    const labels = sorted.map(p=> (p.props.District||'') + ' / ' + (p.props.Tehsil||''));
    const values = sorted.map(p=> p.rain);

    topList.innerHTML = '';
    sorted.forEach(p=>{
      const el = document.createElement('div');
      el.className = 'topItem';
      el.innerHTML = `<b>${p.props.District || ''} - ${p.props.Tehsil || ''}</b><br/> ${p.rain} mm`;
      topList.appendChild(el);
    });

    if (window.topChart) window.topChart.destroy();
    window.topChart = new Chart(chartCtx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Rainfall (mm)', data: values, backgroundColor: values.map(v=> colorForRain(v)) }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
    });
  }

  // hook date picker to loadDataForDate
  if (dateFilter){
    dateFilter.onchange = () => {
      if (dateFilter.value) loadDataForDate(dateFilter.value);
    };
  }

  // Submit button: filter by state, district, date
  submitBtn.onclick = () => {
    if (!geojsonData) return;

    const s = stateFilter.value;
    const d = districtFilter.value;
    const dt = dateFilter.value;

    const filteredFeatures = geojsonData.features.filter(f => {
      const props = f.properties || {};
      let match = true;
      if (s && props.State !== s) match = false;
      if (d && props.District !== d) match = false;
      if (dt && props.Date !== dt) match = false;
      return match;
    });

    if (filteredFeatures.length === 0) {
      alert('No data for selected combination.');
      return;
    }

    const filteredData = { type: 'FeatureCollection', features: filteredFeatures };
    renderData(filteredData);
  };

  // Reset button
  resetBtn.onclick = () => {
    if (originalData) renderData(originalData);
    stateFilter.value = '';
    districtFilter.value = '';
    dateFilter.value = '';
  };

  // Add static footer text
  const footer = document.querySelector('footer');
  footer.innerHTML = '<small>Data: IMD-derived GeoJSON • Auto-updated daily</small>';

  // Add legend bottom-left
  const legend = L.control({position: 'bottomleft'});
  legend.onAdd = function(map){
    const div = L.DomUtil.create('div', 'info legend');
    div.style.background = '#fff';
    div.style.padding = '8px';
    div.style.borderRadius = '6px';
    div.style.boxShadow = '0 0 6px rgba(0,0,0,0.3)';
    let labels = [];
    colorScale.forEach((item,i) => {
      const range = i===0 ? `0` : `${colorScale[i-1].limit} - ${item.limit-1}`;
      labels.push(`<i style="background:${item.color};width:18px;height:18px;display:inline-block;margin-right:6px;"></i> ${range} mm`);
    });
    div.innerHTML = '<b>Rainfall Legend</b><br>' + labels.join('<br>');
    return div;
  };
  legend.addTo(map);

})();

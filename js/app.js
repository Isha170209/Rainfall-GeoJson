// dashboard/js/app.js
(async function(){
  const dataBase = 'data/';
  const manifestUrl = dataBase + 'manifest.json';
  const latestFallback = dataBase + 'latest.geojson';
  const cacheBust = '?_=' + Date.now();

  // Setup map
  const map = L.map('map').setView([22.5, 79], 5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB'
  }).addTo(map);

  // UI elements
  const stateFilter = document.getElementById('stateFilter');
  const districtFilter = document.getElementById('districtFilter');
  const dateFilter = document.getElementById('dateFilter');   // ✅ fixed
  const resetBtn = document.getElementById('resetBtn');
  const fileLabel = document.getElementById('fileLabel');
  const chartCtx = document.getElementById('chart').getContext('2d');
  const topList = document.getElementById('topList');

  let geojsonData = null;
  let markersLayer = L.layerGroup().addTo(map);

  // color scale by rainfall (mm) - simple ramp
  function colorForRain(mm){
    if (mm === null || isNaN(mm)) return '#ccc';
    if (mm === 0) return '#f7fbff';
    if (mm < 5) return '#c6dbef';
    if (mm < 20) return '#6baed6';
    if (mm < 50) return '#2171b5';
    if (mm < 100) return '#08519c';
    return '#08306b';
  }
  function radiusForRain(mm){
    if (mm === null || isNaN(mm)) return 4;
    return Math.min(18, 4 + Math.sqrt(mm));
  }

  // load specific date file
  async function loadDataForDate(isoDate) {
    const url = dataBase + isoDate + ".geojson";
    fileLabel.innerText = "Loading " + isoDate + ".geojson...";

    try {
      const res = await fetch(url + "?cache=" + Date.now());
      if (!res.ok) throw new Error("No data for " + isoDate);

      const gjson = await res.json();
      geojsonData = gjson;
      fileLabel.innerText = "Data: " + isoDate + ".geojson";
      renderData(geojsonData);
    } catch (err) {
      fileLabel.innerText = "No data found for " + isoDate;
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

    // fallback
    return {url: latestFallback + cacheBust};
  }

  const {url, meta} = await loadData();
  fileLabel.innerText = 'Loading ' + (meta && meta.latest ? meta.latest : 'latest.geojson');

  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cache=' + Date.now());
    if (!res.ok) throw new Error('Failed to load geojson');
    geojsonData = await res.json();
    fileLabel.innerText = 'Data: ' + (meta && meta.latest ? meta.latest : 'latest.geojson');
    renderData(geojsonData);
  } catch(err){
    fileLabel.innerText = 'Unable to load data';
    console.error(err);
  }

  function renderData(gjson){
    markersLayer.clearLayers();

    // derive lists for filters
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

    // populate filters
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
      }).bindPopup(`<b>${pt.props.District || ''}, ${pt.props.Tehsil || ''}</b><br/>
                    Rain: ${pt.props.Rainfall} mm<br/>
                    Date: ${pt.props.Date || ''}`);
      circle.feature = pt; // store for filtering
      markersLayer.addLayer(circle);
    });

    // fit to markers
    if (markersLayer.getLayers().length) {
      map.fitBounds(markersLayer.getBounds().pad(0.2));
    }

    // show top N rainfall in chart & list
    showTopChart(points);

    // hook filter events
    stateFilter.onchange = applyFilters;
    districtFilter.onchange = applyFilters;
    resetBtn.onclick = () => { stateFilter.value=''; districtFilter.value=''; applyFilters(); };
  }

  function populateSelect(selectEl, items){
    // items = array; first item assumed '' for All
    selectEl.innerHTML = '';
    items.forEach(i => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.text = i || 'All';
      selectEl.appendChild(opt);
    });
  }

  function applyFilters(){
    const s = stateFilter.value, d = districtFilter.value;
    markersLayer.eachLayer(layer => {
      const pt = layer.feature;
      if(!pt) { layer.addTo(map); return; }
      let show = true;
      if (s && pt.state !== s) show = false;
      if (d && pt.district !== d) show = false;
      if (show) layer.addTo(map); else map.removeLayer(layer);
    });
  }

  function showTopChart(points){
    // top 20 by rainfall
    const sorted = points.filter(p => !isNaN(p.rain)).sort((a,b)=> b.rain - a.rain).slice(0,20);
    const labels = sorted.map((p,i)=> (p.props.District||'') + ' / ' + (p.props.Tehsil||''));
    const values = sorted.map(p=> p.rain);

    // list
    topList.innerHTML = '';
    sorted.forEach(p=>{
      const el = document.createElement('div');
      el.className = 'topItem';
      el.innerHTML = `<b>${p.props.District || ''} - ${p.props.Tehsil || ''}</b><br/> ${p.rain} mm`;
      topList.appendChild(el);
    });

    // Chart.js
    if (window.topChart) window.topChart.destroy();
    window.topChart = new Chart(chartCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Rainfall (mm)',
          data: values,
          backgroundColor: values.map(v => colorForRain(v))
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } }
      }
    });
  }

  // ✅ hook date filter to loadDataForDate
  if (dateFilter){
    dateFilter.onchange = () => {
      if (dateFilter.value){
        loadDataForDate(dateFilter.value); // expects YYYY-MM-DD string
      }
    };
  }

})();

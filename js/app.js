(async function(){
  const dataBase = 'data/';
  const manifestUrl = dataBase + 'manifest.json';
  const latestFallback = dataBase + 'latest.geojson';
  const cacheBust = '?_=' + Date.now();

  // Setup map
  const map = L.map('map').setView([22.5, 79], 5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // UI elements
  const stateFilter = document.getElementById('stateFilter');
  const districtFilter = document.getElementById('districtFilter');
  const tehsilFilter = document.getElementById('tehsilFilter');
  const dateFilter = document.getElementById('dateFilter');
  const submitBtn = document.getElementById('submitBtn');
  const resetBtn = document.getElementById('resetBtn');
  const chartCtx = document.getElementById('chart').getContext('2d');
  const topList = document.getElementById('topList');

  let geojsonData = null;
  let markersLayer = L.layerGroup().addTo(map);

  // Color & size helpers
  function colorForRain(mm){
    if (mm===null || isNaN(mm)) return '#ccc';
    if (mm===0) return '#f7fbff';
    if (mm<5) return '#c6dbef';
    if (mm<20) return '#6baed6';
    if (mm<50) return '#2171b5';
    if (mm<100) return '#08519c';
    return '#08306b';
  }
  function radiusForRain(mm){
    if (mm===null || isNaN(mm)) return 4;
    return Math.min(18, 4 + Math.sqrt(mm));
  }

  // Load initial data
  async function loadData(){
    try {
      const res = await fetch(manifestUrl + cacheBust);
      if (res.ok){
        const m = await res.json();
        const url = dataBase + (m.latest || 'latest.geojson');
        return {url, meta: m};
      }
    } catch(e){}
    return {url: latestFallback + cacheBust};
  }

  const {url, meta} = await loadData();
  try {
    const res = await fetch(url + (url.includes('?')?'&':'?')+'cache='+Date.now());
    geojsonData = await res.json();
    renderData(geojsonData);
  } catch(e){ console.error(e); }

  function renderData(gjson){
    markersLayer.clearLayers();
    const states = new Set(), districts = new Set(), tehsils = new Set();
    const points = [];

    gjson.features.forEach(f=>{
      const coords = f.geometry?.coordinates;
      const p = coords ? [coords[1], coords[0]] : null;
      const props = f.properties || {};
      const rain = parseFloat(props.Rainfall);
      const state = props.State || '';
      const district = props.District || '';
      const tehsil = props.Tehsil || '';

      states.add(state); districts.add(district); tehsils.add(tehsil);
      points.push({latlng: p, props, rain, state, district, tehsil});
    });

    populateSelect(stateFilter, ['', ...Array.from(states).sort()]);
    populateSelect(districtFilter, ['', ...Array.from(districts).sort()]);
    populateSelect(tehsilFilter, ['', ...Array.from(tehsils).sort()]);

    points.forEach(pt=>{
      if(!pt.latlng) return;
      const circle = L.circleMarker(pt.latlng, {
        radius: radiusForRain(pt.rain),
        fillColor: colorForRain(pt.rain),
        color: '#222',
        weight: 0.6,
        fillOpacity: 0.8
      }).bindPopup(`<b>${pt.state} / ${pt.district} / ${pt.tehsil}</b><br>
                    Rain: ${pt.rain} mm`);
      circle.feature = pt;
      markersLayer.addLayer(circle);
    });

    if (markersLayer.getLayers().length)
      map.fitBounds(markersLayer.getBounds().pad(0.2));

    showTopChart(points);

    submitBtn.onclick = ()=>applyFilters(points);
    resetBtn.onclick = ()=>renderData(gjson);
  }

  function populateSelect(selectEl, items){
    selectEl.innerHTML = '';
    items.forEach(i=>{
      const opt = document.createElement('option');
      opt.value = i;
      opt.text = i || 'All';
      selectEl.appendChild(opt);
    });
  }

  function applyFilters(points){
    const s = stateFilter.value, d = districtFilter.value, t = tehsilFilter.value, date = dateFilter.value;
    markersLayer.clearLayers();
    const filtered = points.filter(p=>{
      if(s && p.state!==s) return false;
      if(d && p.district!==d) return false;
      if(t && p.tehsil!==t) return false;
      if(date && p.props.Date!==date) return false;
      return true;
    });

    filtered.forEach(pt=>{
      if(!pt.latlng) return;
      const circle = L.circleMarker(pt.latlng, {
        radius: radiusForRain(pt.rain),
        fillColor: colorForRain(pt.rain),
        color: '#222',
        weight: 0.6,
        fillOpacity: 0.8
      }).bindPopup(`<b>${pt.state} / ${pt.district} / ${pt.tehsil}</b><br>
                    Rain: ${pt.rain} mm`);
      markersLayer.addLayer(circle);
    });

    if (markersLayer.getLayers().length)
      map.fitBounds(markersLayer.getBounds().pad(0.2));

    showTopChart(filtered);
  }

  function showTopChart(points){
    const sorted = points.filter(p=>!isNaN(p.rain)).sort((a,b)=>b.rain-b.rain).slice(0,20);
    const labels = sorted.map(p=>(p.props.District||'')+' / '+(p.props.Tehsil||''));
    const values = sorted.map(p=>p.rain);

    topList.innerHTML = '';
    sorted.forEach(p=>{
      const el = document.createElement('div');
      el.className = 'topItem';
      el.innerHTML = `<b>${p.props.District || ''} - ${p.props.Tehsil || ''}</b><br/> ${p.rain} mm`;
      topList.appendChild(el);
    });

    if(window.topChart) window.topChart.destroy();
    window.topChart = new Chart(chartCtx, {
      type: 'bar',
      data: { labels, datasets:[{label:'Rainfall (mm)', data: values, backgroundColor: values.map(v=>colorForRain(v))}] },
      options: { responsive:true, maintainAspectRatio:false, indexAxis:'y', plugins:{legend:{display:false}} }
    });
  }

  // ===== Legend =====
  const legend = L.control({position:'bottomleft'});
  legend.onAdd = function(){
    const div = L.DomUtil.create('div','legend');
    div.id = 'legend';
    const grades = [0,5,20,50,100];
    const labels = ['0','<5','5-20','20-50','50-100','>100'];
    const colors = ['#f7fbff','#c6dbef','#6baed6','#2171b5','#08519c','#08306b'];
    for(let i=0;i<labels.length;i++){
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-color" style="background:${colors[i]}"></span>${labels[i]} mm`;
      div.appendChild(item);
    }
    return div;
  };
  legend.addTo(map);

})();

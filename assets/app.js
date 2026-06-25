const map = L.map('map', { zoomControl: true }).setView([41.19, 69.62], 8);

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const info = document.getElementById('info');
const kpiBuildings = document.getElementById('kpi-buildings');
const kpiFootprint = document.getElementById('kpi-footprint');
const kpiShare = document.getElementById('kpi-share');
const kpiPilot = document.getElementById('kpi-pilot');

let provinceLayer = null;
let pilotLayer = null;
let buildingLayer = null;
let selectedBuilding = null;
let pilotStats = {};
let pilotBounds = {};

const PILOT_AREAS = [
  { name: 'Nurafshon', bbox: [69.31055, 40.98250, 69.38143, 41.07371] },
  { name: 'Chirchiq', bbox: [69.53160, 41.43098, 69.63162, 41.52848] }
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

function fmt(num, digits = 0) {
  return Number(num || 0).toLocaleString('uz-UZ', { maximumFractionDigits: digits });
}

function setInfo(html) {
  info.innerHTML = html;
}

function provinceStyle() {
  return { color: '#0ea5e9', weight: 2.4, opacity: 0.95, fillColor: '#38bdf8', fillOpacity: 0.035, interactive: false };
}

function pilotStyle(feature) {
  const p = feature.properties || {};
  const active = Number(p.building_count || 0) > 0;
  return {
    color: active ? '#fb923c' : '#f59e0b',
    weight: active ? 2.4 : 1.6,
    opacity: 0.95,
    dashArray: active ? null : '7 7',
    fillColor: '#f97316',
    fillOpacity: active ? 0.13 : 0.07
  };
}

function buildingStyle(feature) {
  const area = Number(feature.properties?.area_m2 || 0);
  return {
    color: area > 400 ? '#7c2d12' : '#ea580c',
    weight: selectedBuilding === feature ? 1.8 : 0.45,
    opacity: 0.85,
    fillColor: area > 400 ? '#dc2626' : '#f97316',
    fillOpacity: selectedBuilding === feature ? 0.92 : 0.68
  };
}

async function loadGeoJSON(url) {
  const res = await fetch(url + '?v=' + Date.now());
  if (!res.ok) throw new Error(`${url} not found`);
  return await res.json();
}

function overpassQuery([w, s, e, n]) {
  return `[out:json][timeout:90];(way["building"](${s},${w},${n},${e}););out tags geom;`;
}

async function fetchOverpass(area) {
  const query = overpassQuery(area.bbox);
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const url = endpoint + '?data=' + encodeURIComponent(query);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      console.warn('Overpass endpoint failed:', endpoint, err);
    }
  }
  throw lastError || new Error('Overpass failed');
}

function osmWayToFeature(element, areaName) {
  const geom = element.geometry || [];
  if (geom.length < 3) return null;
  const coords = geom.map(p => [p.lon, p.lat]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  return {
    type: 'Feature',
    properties: {
      osm_id: `way/${element.id}`,
      building: element.tags?.building || 'yes',
      name: element.tags?.name || null,
      pilot_area: areaName,
      source: 'OpenStreetMap Overpass API'
    },
    geometry: { type: 'Polygon', coordinates: [coords] }
  };
}

function ringAreaM2(coords) {
  const r = 6378137;
  const projected = coords.map(([lon, lat]) => {
    const x = r * lon * Math.PI / 180;
    const y = r * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    return [x, y];
  });
  let sum = 0;
  for (let i = 0; i < projected.length - 1; i++) {
    sum += projected[i][0] * projected[i + 1][1] - projected[i + 1][0] * projected[i][1];
  }
  return Math.abs(sum / 2);
}

function featureAreaM2(feature) {
  try { return ringAreaM2(feature.geometry.coordinates[0]); } catch { return 0; }
}

function bboxToBounds([w, s, e, n]) {
  return L.latLngBounds([[s, w], [n, e]]);
}

function updateKpis() {
  const totals = Object.values(pilotStats).reduce((acc, s) => {
    acc.count += s.count || 0;
    acc.areaM2 += s.areaM2 || 0;
    acc.areaKm2 += s.areaKm2 || 0;
    return acc;
  }, { count: 0, areaM2: 0, areaKm2: 0 });
  const share = totals.areaKm2 ? ((totals.areaM2 / 1000000) / totals.areaKm2) * 100 : 0;
  kpiBuildings.textContent = fmt(totals.count);
  kpiFootprint.textContent = fmt(totals.areaM2 / 1000000, 3);
  kpiShare.textContent = fmt(share, 3);
  kpiPilot.textContent = Object.keys(pilotStats).length || PILOT_AREAS.length;
}

function showSummary() {
  const rows = Object.entries(pilotStats).map(([name, s]) => {
    const share = s.areaKm2 ? ((s.areaM2 / 1000000) / s.areaKm2) * 100 : 0;
    return `<tr><td>${name}</td><td>${fmt(s.count)}</td><td>${fmt(s.areaM2 / 1000000, 3)}</td><td>${fmt(share, 3)}%</td></tr>`;
  }).join('');

  setInfo(`
    <b>Real OSM bino ma’lumoti yuklandi</b><br>
    <span class="muted">Bino footprintlari ustiga bosing — obyekt pasporti chiqadi.</span>
    <table class="mini-table">
      <thead><tr><th>Hudud</th><th>Bino</th><th>km²</th><th>%</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

function updatePilotLayerStats() {
  if (!pilotLayer) return;
  pilotLayer.eachLayer(layer => {
    const props = layer.feature.properties || {};
    const s = pilotStats[props.name];
    if (!s) return;
    props.building_count = s.count;
    props.building_area_m2 = Number(s.areaM2.toFixed(2));
    props.building_area_km2 = Number((s.areaM2 / 1000000).toFixed(6));
    props.built_share_pct = s.areaKm2 ? Number((((s.areaM2 / 1000000) / s.areaKm2) * 100).toFixed(6)) : 0;
    props.data_source = 'OSM live';
    layer.setStyle(pilotStyle(layer.feature));
  });
}

function showPilotInfo(props) {
  setInfo(`
    <b>${props.name}</b><br>
    Maydon: ${fmt(props.area_km2, 2)} km²<br>
    Binolar soni: ${fmt(props.building_count)}<br>
    Footprint maydoni: ${fmt(props.building_area_km2, 3)} km²<br>
    Built-up ulushi: ${fmt(props.built_share_pct, 3)}%<br>
    <span class="muted">Manba: OpenStreetMap building footprintlari</span>
  `);
}

function renderBuildings(geojson, label = 'Bino footprintlari') {
  if (!geojson.features || !geojson.features.length) return null;
  if (buildingLayer) map.removeLayer(buildingLayer);

  buildingLayer = L.geoJSON(geojson, {
    style: buildingStyle,
    onEachFeature: (feature, layer) => {
      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectedBuilding = feature;
        buildingLayer.setStyle(buildingStyle);
        layer.setStyle({ color: '#38bdf8', weight: 2, fillColor: '#0ea5e9', fillOpacity: 0.95 });
        const p = feature.properties || {};
        setInfo(`
          <b>Bino obyekti</b><br>
          Hudud: ${p.pilot_area || '–'}<br>
          OSM ID: ${p.osm_id || '–'}<br>
          Turi: ${p.building || 'building'}<br>
          Footprint: ${fmt(p.area_m2, 1)} m²<br>
          ${p.name ? `Nomi: ${p.name}<br>` : ''}
          <span class="muted">Bu footprint OSM building=* tegi asosida olingan.</span>
        `);
      });
      layer.on('mouseover', () => layer.setStyle({ weight: 1.4, fillOpacity: 0.86 }));
      layer.on('mouseout', () => { if (selectedBuilding !== feature) layer.setStyle(buildingStyle(feature)); });
    }
  }).addTo(map);

  buildingLayer.bringToFront();
  console.log(label, geojson.features.length);
  return buildingLayer;
}

async function loadLiveBuildings() {
  setInfo('OSM orqali Nurafshon va Chirchiq binolari yuklanmoqda...<br><span class="muted">10–60 soniya vaqt olishi mumkin.</span>');
  const features = [];
  pilotStats = {};

  for (const area of PILOT_AREAS) {
    const data = await fetchOverpass(area);
    const areaFeatures = (data.elements || [])
      .filter(el => el.type === 'way' && el.geometry)
      .map(el => osmWayToFeature(el, area.name))
      .filter(Boolean);

    let totalArea = 0;
    for (const feature of areaFeatures) {
      const a = featureAreaM2(feature);
      feature.properties.area_m2 = Number(a.toFixed(2));
      totalArea += a;
    }
    const bbox = bboxToBounds(area.bbox);
    const approxAreaKm2 = Math.max(0.01, (bbox.getNorth() - bbox.getSouth()) * 111 * (bbox.getEast() - bbox.getWest()) * 111 * Math.cos(((bbox.getNorth() + bbox.getSouth()) / 2) * Math.PI / 180));
    pilotStats[area.name] = { count: areaFeatures.length, areaM2: totalArea, areaKm2: approxAreaKm2 };
    features.push(...areaFeatures);
  }

  renderBuildings({ type: 'FeatureCollection', features }, 'Live OSM buildings');
  updatePilotLayerStats();
  updateKpis();
  showSummary();
}

async function init() {
  const province = await loadGeoJSON('data/toshkent_viloyati_boundary.geojson');
  provinceLayer = L.geoJSON(province, { style: provinceStyle, interactive: false }).addTo(map);
  map.fitBounds(provinceLayer.getBounds(), { padding: [26, 26] });

  const districts = await loadGeoJSON('data/toshkent_viloyati_tumanlar.geojson');
  const pilotFeatures = {
    type: 'FeatureCollection',
    features: districts.features.filter(f => PILOT_AREAS.some(a => a.name === f.properties?.name))
  };

  pilotLayer = L.geoJSON(pilotFeatures, {
    style: pilotStyle,
    onEachFeature: (feature, layer) => {
      pilotBounds[feature.properties.name] = layer.getBounds();
      layer.on('click', () => showPilotInfo(feature.properties || {}));
      layer.bindTooltip(feature.properties?.name || '', { sticky: true });
    }
  }).addTo(map);

  let hasStaticBuildings = false;
  try {
    const buildings = await loadGeoJSON('data/buildings.geojson');
    hasStaticBuildings = Boolean(buildings.features && buildings.features.length);
    if (hasStaticBuildings) renderBuildings(buildings, 'Static buildings.geojson');
  } catch (e) {
    console.warn('buildings.geojson not loaded yet', e);
  }

  if (!hasStaticBuildings) {
    try { await loadLiveBuildings(); }
    catch (e) {
      console.error('Live OSM building load failed', e);
      setInfo('Viloyat xaritasi ishlayapti, lekin OSM bino ma’lumoti hozir yuklanmadi.<br><span class="muted">Overpass API vaqtincha javob bermagan bo‘lishi mumkin.</span>');
    }
  }

  L.control.layers({ 'OSM basemap': osm }, { 'Viloyat chegarasi': provinceLayer, 'Pilot hududlar': pilotLayer, 'Bino footprintlari': buildingLayer }, { collapsed: true }).addTo(map);
}

document.querySelectorAll('[data-focus]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-focus]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const key = btn.dataset.focus;
    if (key === 'all') {
      if (provinceLayer) map.fitBounds(provinceLayer.getBounds(), { padding: [26, 26] });
      showSummary();
    } else if (pilotBounds[key]) {
      map.fitBounds(pilotBounds[key], { padding: [40, 40] });
      const pLayer = Object.values(pilotLayer._layers).find(l => l.feature.properties.name === key);
      if (pLayer) showPilotInfo(pLayer.feature.properties);
    }
  });
});

init().catch(err => {
  console.error(err);
  info.textContent = 'Xarita yuklashda xatolik: ' + err.message;
});

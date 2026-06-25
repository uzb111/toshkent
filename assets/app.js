const map = L.map('map', { zoomControl: true }).setView([41.19, 69.62], 8);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const info = document.getElementById('info');
let selectedLayer = null;
let districtLayer = null;

const PILOT_AREAS = [
  { name: 'Nurafshon', bbox: [69.31055, 40.98250, 69.38143, 41.07371] },
  { name: 'Chirchiq', bbox: [69.53160, 41.43098, 69.63162, 41.52848] }
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

function districtStyle(feature) {
  const p = feature.properties || {};
  const builtShare = Number(p.built_share_pct || 0);
  const hasPilotData = Number(p.building_count || 0) > 0;
  const fillOpacity = builtShare > 0 ? Math.min(0.72, 0.14 + builtShare / 35) : 0.10;
  return {
    color: hasPilotData ? '#fb923c' : '#7dd3fc',
    weight: hasPilotData ? 1.8 : 1.1,
    opacity: 0.95,
    fillColor: hasPilotData ? '#f97316' : '#1f2937',
    fillOpacity: hasPilotData ? Math.max(0.24, fillOpacity) : 0.10
  };
}

function selectFeature(layer, props) {
  if (selectedLayer) selectedLayer.setStyle(districtStyle(selectedLayer.feature));
  selectedLayer = layer;
  layer.setStyle({ color: '#38bdf8', weight: 3, fillOpacity: 0.38 });
  const rows = [
    `<b>${props.name || 'Hudud'}</b>`,
    `Maydon: ${Number(props.area_km2 || 0).toLocaleString('uz-UZ', { maximumFractionDigits: 1 })} km²`,
    props.building_count ? `Binolar soni: ${Number(props.building_count).toLocaleString('uz-UZ')}` : null,
    props.building_area_km2 ? `Bino footprint maydoni: ${Number(props.building_area_km2).toLocaleString('uz-UZ', { maximumFractionDigits: 3 })} km²` : null,
    props.built_share_pct ? `Built-up ulushi: ${Number(props.built_share_pct).toLocaleString('uz-UZ', { maximumFractionDigits: 3 })}%` : null,
    props.data_source ? `Manba: ${props.data_source}` : null
  ].filter(Boolean);
  info.innerHTML = rows.join('<br>');
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
  try {
    return ringAreaM2(feature.geometry.coordinates[0]);
  } catch {
    return 0;
  }
}

function updateDistrictStats(stats) {
  if (!districtLayer) return;
  districtLayer.eachLayer(layer => {
    const props = layer.feature.properties || {};
    const item = stats[props.name];
    if (!item) return;
    const areaKm2 = Number(props.area_km2 || 0);
    props.building_count = item.count;
    props.building_area_m2 = Number(item.areaM2.toFixed(2));
    props.building_area_km2 = Number((item.areaM2 / 1000000).toFixed(6));
    props.building_density_per_km2 = areaKm2 ? Number((item.count / areaKm2).toFixed(3)) : 0;
    props.built_share_pct = areaKm2 ? Number(((item.areaM2 / 1000000) / areaKm2 * 100).toFixed(6)) : 0;
    props.data_source = 'OSM live';
    layer.setStyle(districtStyle(layer.feature));
  });
}

function renderBuildings(geojson, label = 'Bino footprintlari') {
  if (!geojson.features || !geojson.features.length) return null;
  const layer = L.geoJSON(geojson, {
    style: { color: '#ea580c', weight: 0.35, opacity: 0.75, fillColor: '#f97316', fillOpacity: 0.62 },
    interactive: false
  }).addTo(map);
  layer.bringToFront();
  console.log(label, geojson.features.length);
  return layer;
}

async function loadLiveBuildings() {
  info.innerHTML = 'OSM orqali Nurafshon va Chirchiq binolari yuklanmoqda...<br><span class="muted">10–60 soniya vaqt olishi mumkin.</span>';
  const features = [];
  const stats = {};

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
    stats[area.name] = { count: areaFeatures.length, areaM2: totalArea };
    features.push(...areaFeatures);
  }

  const geojson = { type: 'FeatureCollection', features };
  renderBuildings(geojson, 'Live OSM buildings');
  updateDistrictStats(stats);

  const lines = Object.entries(stats).map(([name, s]) => `${name}: <b>${s.count.toLocaleString('uz-UZ')}</b> bino`);
  info.innerHTML = `Real OSM bino ma’lumoti yuklandi.<br>${lines.join('<br>')}<br><br>Hudud ustiga bosing.`;
}

async function init() {
  const districts = await loadGeoJSON('data/toshkent_viloyati_tumanlar.geojson');
  districtLayer = L.geoJSON(districts, {
    style: districtStyle,
    onEachFeature: (feature, layer) => {
      layer.on({
        click: () => selectFeature(layer, feature.properties || {}),
        mouseover: () => layer.setStyle({ weight: 2.4 }),
        mouseout: () => { if (layer !== selectedLayer) layer.setStyle(districtStyle(feature)); }
      });
      layer.bindTooltip(feature.properties?.name || '', { sticky: true });
    }
  }).addTo(map);
  map.fitBounds(districtLayer.getBounds(), { padding: [20, 20] });

  let hasStaticBuildings = false;
  try {
    const buildings = await loadGeoJSON('data/buildings.geojson');
    hasStaticBuildings = Boolean(buildings.features && buildings.features.length);
    if (hasStaticBuildings) renderBuildings(buildings, 'Static buildings.geojson');
  } catch (e) {
    console.warn('buildings.geojson not loaded yet', e);
  }

  if (!hasStaticBuildings) {
    try {
      await loadLiveBuildings();
    } catch (e) {
      console.error('Live OSM building load failed', e);
      info.innerHTML = 'Boundary xarita ishlayapti, lekin OSM bino ma’lumoti hozir yuklanmadi.<br>Actions yoki Overpass API qayta ishga tushiriladi.';
    }
  }
}

init().catch(err => {
  console.error(err);
  info.textContent = 'Xarita yuklashda xatolik: ' + err.message;
});

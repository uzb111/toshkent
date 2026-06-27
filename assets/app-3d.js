const AREA = { name: 'Chirchiq', bbox: [69.53160, 41.43098, 69.63162, 41.52848] };
const API = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const info = document.getElementById('info');
const details = document.getElementById('detailsContent');
const kpiBuildings = document.getElementById('kpi-buildings');
const kpiFootprint = document.getElementById('kpi-footprint');
const kpiShare = document.getElementById('kpi-share');
const kpiHotspots = document.getElementById('kpi-hotspots');
const brightnessInput = document.getElementById('gridBrightness');
const brightnessValue = document.getElementById('gridBrightnessValue');

function fmt(v, d = 0) { return Number(v || 0).toLocaleString('uz-UZ', { maximumFractionDigits: d }); }
function setInfo(html) { info.innerHTML = html; }
function setDetails(html) { details.innerHTML = html; }

const map = new maplibregl.Map({
  container: 'map',
  center: [69.584, 41.475],
  zoom: 12.15,
  pitch: 61,
  bearing: -22,
  antialias: true,
  style: {
    version: 8,
    sources: {
      dark: {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', 'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', 'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors © CARTO'
      }
    },
    layers: [{ id: 'dark', type: 'raster', source: 'dark', paint: { 'raster-brightness-min': 0.05, 'raster-brightness-max': 0.72, 'raster-saturation': -0.65 } }]
  }
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

async function getBuildings() {
  const [w, s, e, n] = AREA.bbox;
  const q = `[out:json][timeout:90];(way["building"](${s},${w},${n},${e}););out tags geom;`;
  let last;
  for (const endpoint of API) {
    try {
      const r = await fetch(endpoint + '?data=' + encodeURIComponent(q), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    } catch (e) { last = e; }
  }
  throw last || new Error('building request failed');
}

function areaM2(coords) {
  const R = 6378137;
  const pts = coords.map(([lon, lat]) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))]);
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) sum += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return Math.abs(sum / 2);
}

function featureCenter(f) {
  const c = f.geometry.coordinates[0];
  let x = 0, y = 0;
  c.forEach(p => { x += p[0]; y += p[1]; });
  return [x / c.length, y / c.length];
}

function toFeature(el) {
  const g = el.geometry || [];
  if (g.length < 3) return null;
  const coords = g.map(p => [p.lon, p.lat]);
  if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) coords.push(coords[0]);
  const a = areaM2(coords);
  const h = Math.max(5, Math.min(80, Math.sqrt(a) * 0.9));
  return {
    type: 'Feature',
    properties: { osm_id: 'way/' + el.id, building: el.tags?.building || 'yes', name: el.tags?.name || '', area_m2: a, height_m: h },
    geometry: { type: 'Polygon', coordinates: [coords] }
  };
}

function bboxAreaKm2([w, s, e, n]) {
  const mid = (s + n) / 2;
  return Math.abs((n - s) * 111 * (e - w) * 111 * Math.cos(mid * Math.PI / 180));
}

function hexPolygon(cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  pts.push(pts[0]);
  return pts;
}

function makeHex(features) {
  const [w, s, e, n] = AREA.bbox;
  const rx = 0.0048;
  const ry = 0.0035;
  const colW = Math.sqrt(3) * rx;
  const rowH = 1.5 * ry;
  const bins = new Map();

  features.forEach(f => {
    const [lon, lat] = featureCenter(f);
    const row = Math.floor((lat - s) / rowH);
    const offset = row % 2 ? colW / 2 : 0;
    const col = Math.floor((lon - w - offset) / colW);
    if (row < 0 || col < 0) return;
    const key = col + ':' + row;
    const item = bins.get(key) || { col, row, count: 0, area: 0 };
    item.count++;
    item.area += f.properties.area_m2 || 0;
    bins.set(key, item);
  });

  const out = [];
  bins.forEach(item => {
    if (item.count < 4) return;
    const cx = w + item.col * colW + (item.row % 2 ? colW / 2 : 0) + colW / 2;
    const cy = s + item.row * rowH + ry;
    if (cx < w || cx > e || cy < s || cy > n) return;
    out.push({
      type: 'Feature',
      properties: { count: item.count, area: item.area, height_m: Math.min(120, 8 + item.count * 3.2) },
      geometry: { type: 'Polygon', coordinates: [hexPolygon(cx, cy, rx, ry)] }
    });
  });
  return { type: 'FeatureCollection', features: out };
}

function updateKpi(stats) {
  const share = stats.areaKm2 ? (stats.areaM2 / 1000000 / stats.areaKm2) * 100 : 0;
  kpiBuildings.textContent = fmt(stats.count);
  kpiFootprint.textContent = fmt(stats.areaM2 / 1000000, 3);
  kpiShare.textContent = fmt(share, 3) + '%';
  kpiHotspots.textContent = fmt(stats.hotspots);
  setInfo(`<b>Chirchiq 3D urban footprint</b><br><span class="muted">Binolar 3D extrusion sifatida ko‘tarildi. Hex ustunlar qurilish zichligini bildiradi. Slider orqali hex grid yorug‘ligini boshqaring.</span><table class="mini-table"><tr><th>Indikator</th><th>Qiymat</th></tr><tr><td>Bino soni</td><td>${fmt(stats.count)}</td></tr><tr><td>Footprint</td><td>${fmt(stats.areaM2 / 1000000, 3)} km²</td></tr><tr><td>Built-up ulushi</td><td>${fmt(share, 3)}%</td></tr><tr><td>Hex ustunlar</td><td>${fmt(stats.hotspots)}</td></tr></table>`);
}

function addLayers(buildings, hex, stats) {
  map.addSource('buildings', { type: 'geojson', data: buildings });
  map.addSource('hexgrid', { type: 'geojson', data: hex });

  map.addLayer({
    id: 'hex-3d',
    type: 'fill-extrusion',
    source: 'hexgrid',
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'count'], 4, '#facc15', 20, '#f97316', 45, '#ef4444'],
      'fill-extrusion-height': ['get', 'height_m'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.34
    }
  });

  map.addLayer({
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: 'buildings',
    paint: {
      'fill-extrusion-color': ['case', ['>', ['get', 'area_m2'], 450], '#ff5138', '#ffb36b'],
      'fill-extrusion-height': ['get', 'height_m'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.88
    }
  });

  map.on('click', 'buildings-3d', e => {
    const p = e.features[0].properties;
    setDetails(`<b>3D bino obyekti</b><br>Hudud: Chirchiq<br>OSM ID: ${p.osm_id}<br>Turi: ${p.building}<br>Footprint: ${fmt(p.area_m2, 1)} m²<br>Vizual balandlik: ${fmt(p.height_m, 1)} m<br>${p.name ? 'Nomi: ' + p.name + '<br>' : ''}<span class="muted">Balandlik haqiqiy bino qavati emas, footprint maydoniga asoslangan vizual extrusion.</span>`);
  });

  map.on('click', 'hex-3d', e => {
    const p = e.features[0].properties;
    setDetails(`<b>3D hex zichlik ustuni</b><br>Bino soni: ${fmt(p.count)}<br>Footprint yig‘indisi: ${fmt(p.area, 1)} m²<br>Ustun balandligi: ${fmt(p.height_m, 1)} m<br><span class="muted">Hex ustunlar urban construction concentration ko‘rsatkichidir.</span>`);
  });

  map.on('mouseenter', 'buildings-3d', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'buildings-3d', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'hex-3d', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'hex-3d', () => map.getCanvas().style.cursor = '');

  updateKpi(stats);
}

function setGridBrightness(value) {
  const v = Number(value) / 100;
  brightnessValue.textContent = Math.round(v * 100) + '%';
  if (map.getLayer('hex-3d')) {
    map.setPaintProperty('hex-3d', 'fill-extrusion-opacity', Math.max(0.05, Math.min(0.82, v)));
  }
}

brightnessInput?.addEventListener('input', e => setGridBrightness(e.target.value));

map.on('load', async () => {
  try {
    setInfo('Chirchiq 3D urban map yuklanmoqda...');
    setDetails('3D bino yoki hex ustun ustiga bosing. Ma’lumot shu panelda chiqadi.');
    const data = await getBuildings();
    const features = (data.elements || []).filter(el => el.type === 'way' && el.geometry).map(toFeature).filter(Boolean);
    const buildings = { type: 'FeatureCollection', features };
    const hex = makeHex(features);
    const stats = { count: features.length, areaM2: features.reduce((s, f) => s + f.properties.area_m2, 0), areaKm2: bboxAreaKm2(AREA.bbox), hotspots: hex.features.length };
    addLayers(buildings, hex, stats);
    setGridBrightness(brightnessInput?.value || 34);
    map.fitBounds([[AREA.bbox[0], AREA.bbox[1]], [AREA.bbox[2], AREA.bbox[3]]], { padding: 65, pitch: 61, bearing: -22 });
  } catch (err) {
    console.error(err);
    setInfo('3D xarita yuklashda xatolik: ' + err.message);
    setDetails('Overpass API javob bermadi yoki brauzer requestni blokladi. Sahifani qayta yangilang.');
  }
});

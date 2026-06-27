const AREA = { name: 'Chirchiq-core', bbox: [69.548, 41.435, 69.615, 41.505] };
const API = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.osm.ch/api/interpreter'];
const CACHE_KEY = 'chirchiq-3d-buildings-v2';

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
function safeGetCache() { try { return localStorage.getItem(CACHE_KEY); } catch { return null; } }
function safeSetCache(value) { try { localStorage.setItem(CACHE_KEY, value); } catch {} }

const map = new maplibregl.Map({
  container: 'map',
  center: [69.584, 41.472],
  zoom: 12.9,
  pitch: 62,
  bearing: -28,
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
    layers: [{ id: 'dark', type: 'raster', source: 'dark', paint: { 'raster-brightness-min': 0.02, 'raster-brightness-max': 0.58, 'raster-saturation': -0.75 } }],
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.6, position: [1.1, 210, 35] }
  }
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

async function getBuildings() {
  const cached = safeGetCache();
  if (cached) {
    setInfo('Cache’dan 3D bino ma’lumoti yuklanmoqda...');
    return JSON.parse(cached);
  }
  const [w, s, e, n] = AREA.bbox;
  const q = `[out:json][timeout:45];(way["building"](${s},${w},${n},${e}););out tags geom;`;
  let last;
  for (const endpoint of API) {
    try {
      setInfo(`OSM binolar yuklanmoqda...<br><span class="muted">Server: ${endpoint.replace('https://','')}</span>`);
      const body = 'data=' + encodeURIComponent(q);
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body, cache: 'no-store' });
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      const json = await r.json();
      safeSetCache(JSON.stringify(json));
      return json;
    } catch (e) { last = e; console.warn('Overpass failed:', endpoint, e); }
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
  if (a < 12) return null;
  const h = Math.max(8, Math.min(75, Math.sqrt(a) * 1.05));
  return { type: 'Feature', properties: { osm_id: 'way/' + el.id, building: el.tags?.building || 'yes', name: el.tags?.name || '', area_m2: a, height_m: h }, geometry: { type: 'Polygon', coordinates: [coords] } };
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
  const rx = 0.0042;
  const ry = 0.00305;
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
    item.count += 1;
    item.area += f.properties.area_m2 || 0;
    bins.set(key, item);
  });
  const out = [];
  bins.forEach(item => {
    if (item.count < 3) return;
    const cx = w + item.col * colW + (item.row % 2 ? colW / 2 : 0) + colW / 2;
    const cy = s + item.row * rowH + ry;
    if (cx < w || cx > e || cy < s || cy > n) return;
    out.push({ type: 'Feature', properties: { count: item.count, area: item.area, height_m: Math.min(140, 10 + item.count * 4.2) }, geometry: { type: 'Polygon', coordinates: [hexPolygon(cx, cy, rx, ry)] } });
  });
  return { type: 'FeatureCollection', features: out };
}

function updateKpi(stats) {
  const share = stats.areaKm2 ? (stats.areaM2 / 1000000 / stats.areaKm2) * 100 : 0;
  kpiBuildings.textContent = fmt(stats.count);
  kpiFootprint.textContent = fmt(stats.areaM2 / 1000000, 3);
  kpiShare.textContent = fmt(share, 3) + '%';
  kpiHotspots.textContent = fmt(stats.hotspots);
  setInfo(`<b>Chirchiq 3D urban footprint</b><br><span class="muted">Tezlashtirilgan core-AOI ishlayapti. Birinchi yuklashdan keyin bino ma’lumoti cache’da qoladi va keyingi ochilish tez bo‘ladi.</span><table class="mini-table"><tr><th>Indikator</th><th>Qiymat</th></tr><tr><td>Bino soni</td><td>${fmt(stats.count)}</td></tr><tr><td>Footprint</td><td>${fmt(stats.areaM2 / 1000000, 3)} km²</td></tr><tr><td>Built-up ulushi</td><td>${fmt(share, 3)}%</td></tr><tr><td>Hex ustunlar</td><td>${fmt(stats.hotspots)}</td></tr></table>`);
}

function addLayers(buildings, hex, stats) {
  map.addSource('buildings', { type: 'geojson', data: buildings });
  map.addSource('hexgrid', { type: 'geojson', data: hex });
  map.addLayer({ id: 'hex-3d', type: 'fill-extrusion', source: 'hexgrid', paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'count'], 3, '#facc15', 18, '#f97316', 40, '#ef4444'], 'fill-extrusion-height': ['get', 'height_m'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.34, 'fill-extrusion-vertical-gradient': true } });
  map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'buildings', paint: { 'fill-extrusion-color': ['case', ['>', ['get', 'area_m2'], 450], '#ff5a40', '#ffbd7a'], 'fill-extrusion-height': ['get', 'height_m'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true } });
  map.addLayer({ id: 'buildings-flat-glow', type: 'line', source: 'buildings', paint: { 'line-color': '#ffd4a3', 'line-width': 0.35, 'line-opacity': 0.55 } });
  map.on('click', 'buildings-3d', e => { const p = e.features[0].properties; setDetails(`<b>3D bino obyekti</b><br>Hudud: Chirchiq core<br>OSM ID: ${p.osm_id}<br>Turi: ${p.building}<br>Footprint: ${fmt(p.area_m2, 1)} m²<br>Vizual balandlik: ${fmt(p.height_m, 1)} m<br>${p.name ? 'Nomi: ' + p.name + '<br>' : ''}<span class="muted">Balandlik haqiqiy qavat emas, vizual extrusion.</span>`); });
  map.on('click', 'hex-3d', e => { const p = e.features[0].properties; setDetails(`<b>3D hex zichlik ustuni</b><br>Bino soni: ${fmt(p.count)}<br>Footprint yig‘indisi: ${fmt(p.area, 1)} m²<br>Ustun balandligi: ${fmt(p.height_m, 1)} m<br><span class="muted">Hex ustunlar urban construction concentration ko‘rsatkichidir.</span>`); });
  ['buildings-3d','hex-3d'].forEach(id => { map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', id, () => map.getCanvas().style.cursor = ''); });
  updateKpi(stats);
}

function setGridBrightness(value) {
  const v = Number(value) / 100;
  brightnessValue.textContent = Math.round(v * 100) + '%';
  if (map.getLayer('hex-3d')) map.setPaintProperty('hex-3d', 'fill-extrusion-opacity', Math.max(0.05, Math.min(0.82, v)));
}
brightnessInput?.addEventListener('input', e => setGridBrightness(e.target.value));

map.on('load', async () => {
  try {
    setDetails('3D bino yoki hex ustun ustiga bosing. Ma’lumot shu panelda chiqadi.');
    const data = await getBuildings();
    const features = (data.elements || []).filter(el => el.type === 'way' && el.geometry).map(toFeature).filter(Boolean);
    const buildings = { type: 'FeatureCollection', features };
    const hex = makeHex(features);
    const stats = { count: features.length, areaM2: features.reduce((s, f) => s + f.properties.area_m2, 0), areaKm2: bboxAreaKm2(AREA.bbox), hotspots: hex.features.length };
    addLayers(buildings, hex, stats);
    setGridBrightness(brightnessInput?.value || 34);
    map.easeTo({ center: [69.584, 41.472], zoom: 13.05, pitch: 62, bearing: -28, duration: 0 });
  } catch (err) {
    console.error(err);
    setInfo('3D xarita yuklashda xatolik: ' + err.message);
    setDetails('Overpass server javob bermadi. Bir necha soniyadan keyin refresh qiling yoki keyingi bosqichda statik GeoJSON faylga o‘tkazamiz.');
  }
});

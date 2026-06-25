const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([41.47, 69.58], 11);
map.createPane('aoiPane');
map.createPane('gridPane');
map.createPane('buildingPane');
map.getPane('aoiPane').style.zIndex = 420;
map.getPane('gridPane').style.zIndex = 520;
map.getPane('buildingPane').style.zIndex = 660;

const base = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

const info = document.getElementById('info');
const details = document.getElementById('detailsContent');
const kpiBuildings = document.getElementById('kpi-buildings');
const kpiFootprint = document.getElementById('kpi-footprint');
const kpiShare = document.getElementById('kpi-share');
const kpiHotspots = document.getElementById('kpi-hotspots');

const AREA = { name: 'Chirchiq', bbox: [69.53160, 41.43098, 69.63162, 41.52848] };
const API = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let provinceLayer, aoiLayer, gridLayer, buildingLayer, selectedLayer, stats;

function fmt(v, d = 0) { return Number(v || 0).toLocaleString('uz-UZ', { maximumFractionDigits: d }); }
function setInfo(html) { info.innerHTML = html; }
function setDetails(html) { details.innerHTML = html; }

async function loadJSON(url) {
  const r = await fetch(url + '?v=' + Date.now());
  if (!r.ok) throw new Error(url + ' not loaded');
  return r.json();
}

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

function toFeature(el) {
  const g = el.geometry || [];
  if (g.length < 3) return null;
  const coords = g.map(p => [p.lon, p.lat]);
  if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) coords.push(coords[0]);
  const a = areaM2(coords);
  return { type: 'Feature', properties: { osm_id: 'way/' + el.id, building: el.tags?.building || 'yes', name: el.tags?.name || '', area_m2: a, source: 'OpenStreetMap' }, geometry: { type: 'Polygon', coordinates: [coords] } };
}

function center(f) {
  const c = f.geometry.coordinates[0];
  let x = 0, y = 0;
  c.forEach(p => { x += p[0]; y += p[1]; });
  return [x / c.length, y / c.length];
}

function bboxAreaKm2([w, s, e, n]) {
  const mid = (s + n) / 2;
  return Math.abs((n - s) * 111 * (e - w) * 111 * Math.cos(mid * Math.PI / 180));
}

function makeGrid(features) {
  const [w, s, e, n] = AREA.bbox;
  const step = 0.006;
  const cells = new Map();
  features.forEach(f => {
    const [lon, lat] = center(f);
    const gx = Math.floor((lon - w) / step), gy = Math.floor((lat - s) / step);
    if (gx < 0 || gy < 0) return;
    const key = gx + ':' + gy;
    const item = cells.get(key) || { gx, gy, count: 0, area: 0 };
    item.count++;
    item.area += f.properties.area_m2 || 0;
    cells.set(key, item);
  });
  const out = [];
  cells.forEach(item => {
    if (item.count < 4) return;
    const x1 = w + item.gx * step, y1 = s + item.gy * step, x2 = Math.min(e, x1 + step), y2 = Math.min(n, y1 + step);
    out.push({ type: 'Feature', properties: item, geometry: { type: 'Polygon', coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]] } });
  });
  return { type: 'FeatureCollection', features: out };
}

function gridStyle(f) {
  const c = f.properties.count;
  const color = c >= 45 ? '#ef4444' : c >= 25 ? '#f97316' : c >= 10 ? '#facc15' : '#f59e0b';
  const op = c >= 45 ? 0.45 : c >= 25 ? 0.35 : 0.24;
  return { pane: 'gridPane', color, weight: 0.8, opacity: 0.65, fillColor: color, fillOpacity: op };
}

function buildingStyle(f) {
  const big = Number(f.properties.area_m2 || 0) > 450;
  return { pane: 'buildingPane', color: big ? '#fed7aa' : '#fdba74', weight: big ? 0.75 : 0.45, opacity: 0.95, fillColor: big ? '#ef4444' : '#f97316', fillOpacity: big ? 0.82 : 0.68 };
}

function showStats() {
  const share = stats.areaKm2 ? (stats.areaM2 / 1000000 / stats.areaKm2) * 100 : 0;
  kpiBuildings.textContent = fmt(stats.count);
  kpiFootprint.textContent = fmt(stats.areaM2 / 1000000, 3);
  kpiShare.textContent = fmt(share, 3) + '%';
  kpiHotspots.textContent = fmt(stats.hotspots);
  setInfo(`<b>Chirchiq urban footprint baseline</b><br><span class="muted">Mavjud qurilish footprintlari urbanizatsiya bosimi va zichlik o‘choqlarini baholash uchun ishlatildi. Keyingi bosqichda GHSL/Sentinel orqali 2015–2020–2025 dinamika ulanadi.</span><table class="mini-table"><tr><th>Indikator</th><th>Qiymat</th></tr><tr><td>Bino soni</td><td>${fmt(stats.count)}</td></tr><tr><td>Footprint</td><td>${fmt(stats.areaM2 / 1000000, 3)} km²</td></tr><tr><td>Built-up ulushi</td><td>${fmt(share, 3)}%</td></tr><tr><td>Zichlik o‘choqlari</td><td>${fmt(stats.hotspots)}</td></tr></table>`);
}

function render(features) {
  const grid = makeGrid(features);
  stats = { count: features.length, areaM2: features.reduce((s, f) => s + f.properties.area_m2, 0), areaKm2: bboxAreaKm2(AREA.bbox), hotspots: grid.features.length };

  gridLayer = L.geoJSON(grid, { style: gridStyle, onEachFeature: (f, l) => l.on('click', () => setDetails(`<b>Qurilish zichligi o‘chog‘i</b><br>Bino soni: ${fmt(f.properties.count)}<br>Footprint yig‘indisi: ${fmt(f.properties.area, 1)} m²<br><span class="muted">Grid asosidagi construction intensity indikatori.</span>`)) }).addTo(map);

  buildingLayer = L.geoJSON({ type: 'FeatureCollection', features }, { style: buildingStyle, onEachFeature: (f, l) => {
    l.on('click', e => {
      L.DomEvent.stopPropagation(e);
      if (selectedLayer) selectedLayer.setStyle(buildingStyle(selectedLayer.feature));
      selectedLayer = l;
      l.setStyle({ pane: 'buildingPane', color: '#67e8f9', weight: 2.2, opacity: 1, fillColor: '#06b6d4', fillOpacity: 0.96 });
      const p = f.properties;
      setDetails(`<b>Bino obyekti</b><br>Hudud: Chirchiq<br>OSM ID: ${p.osm_id}<br>Turi: ${p.building}<br>Footprint: ${fmt(p.area_m2, 1)} m²<br>${p.name ? 'Nomi: ' + p.name + '<br>' : ''}<span class="muted">Bino footprinti qurilish izi sifatida tahlil qilindi.</span>`);
    });
    l.on('mouseover', () => l.setStyle({ weight: 1.4, fillOpacity: 0.9 }));
    l.on('mouseout', () => { if (selectedLayer !== l) l.setStyle(buildingStyle(f)); });
  }}).addTo(map);
  buildingLayer.bringToFront();
  showStats();
}

async function init() {
  const province = await loadJSON('data/toshkent_viloyati_boundary.geojson');
  provinceLayer = L.geoJSON(province, { style: { pane: 'aoiPane', color: '#38bdf8', weight: 2, opacity: 0.9, fillOpacity: 0.015 }, interactive: false }).addTo(map);

  const districts = await loadJSON('data/toshkent_viloyati_tumanlar.geojson');
  const chirchiq = { type: 'FeatureCollection', features: districts.features.filter(f => f.properties?.name === 'Chirchiq') };
  aoiLayer = L.geoJSON(chirchiq, { style: { pane: 'aoiPane', color: '#fb923c', weight: 2.6, opacity: 0.98, fillColor: '#f97316', fillOpacity: 0.035 }, interactive: false }).addTo(map);
  map.fitBounds(aoiLayer.getBounds(), { padding: [40, 40] });

  setInfo('Chirchiq bo‘yicha night-mode urban analytics yuklanmoqda...');
  const data = await getBuildings();
  const features = (data.elements || []).filter(el => el.type === 'way' && el.geometry).map(toFeature).filter(Boolean);
  render(features);
  setDetails('Bino footprinti yoki zichlik o‘chog‘i ustiga bosing. Ma’lumot shu panelda chiqadi.');
  L.control.layers({ 'Night basemap': base }, { 'Viloyat chegarasi': provinceLayer, 'Chirchiq AOI': aoiLayer, 'Qurilish zichligi': gridLayer, 'Bino footprintlari': buildingLayer }, { collapsed: true }).addTo(map);
}

document.querySelectorAll('[data-focus]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-focus]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (btn.dataset.focus === 'all') map.fitBounds(provinceLayer.getBounds(), { padding: [28, 28] });
  else map.fitBounds(aoiLayer.getBounds(), { padding: [40, 40] });
  if (stats) showStats();
}));

init().catch(err => {
  console.error(err);
  setInfo('Xarita yuklashda xatolik: ' + err.message);
  setDetails('Overpass yoki data fayl javob bermadi. Sahifani qayta yangilang.');
});

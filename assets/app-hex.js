const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([41.47, 69.58], 12);
map.createPane('hexPane');
map.createPane('buildingPane');
map.getPane('hexPane').style.zIndex = 520;
map.getPane('buildingPane').style.zIndex = 660;

const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const info = document.getElementById('info');
const details = document.getElementById('detailsContent');
const kpiBuildings = document.getElementById('kpi-buildings');
const kpiFootprint = document.getElementById('kpi-footprint');
const kpiShare = document.getElementById('kpi-share');
const kpiHotspots = document.getElementById('kpi-hotspots');

const AREA = { name: 'Chirchiq', bbox: [69.53160, 41.43098, 69.63162, 41.52848] };
const API = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let hexLayer, buildingLayer, selectedLayer, stats;

function fmt(v, d = 0) { return Number(v || 0).toLocaleString('uz-UZ', { maximumFractionDigits: d }); }
function setInfo(html) { info.innerHTML = html; }
function setDetails(html) { details.innerHTML = html; }

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
  return {
    type: 'Feature',
    properties: { osm_id: 'way/' + el.id, building: el.tags?.building || 'yes', name: el.tags?.name || '', area_m2: areaM2(coords) },
    geometry: { type: 'Polygon', coordinates: [coords] }
  };
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

function hexPolygon(cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  pts.push(pts[0]);
  return pts;
}

function makeHexGrid(features) {
  const [w, s, e, n] = AREA.bbox;
  const rx = 0.0048;
  const ry = 0.0035;
  const colW = Math.sqrt(3) * rx;
  const rowH = 1.5 * ry;
  const bins = new Map();

  features.forEach(f => {
    const [lon, lat] = center(f);
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
    if (item.count < 4) return;
    const cx = w + item.col * colW + (item.row % 2 ? colW / 2 : 0) + colW / 2;
    const cy = s + item.row * rowH + ry;
    if (cx < w || cx > e || cy < s || cy > n) return;
    out.push({
      type: 'Feature',
      properties: { count: item.count, area: item.area },
      geometry: { type: 'Polygon', coordinates: [hexPolygon(cx, cy, rx, ry)] }
    });
  });
  return { type: 'FeatureCollection', features: out };
}

function hexStyle(f) {
  const c = f.properties.count;
  const color = c >= 45 ? '#ef4444' : c >= 25 ? '#f97316' : c >= 10 ? '#facc15' : '#f59e0b';
  const opacity = c >= 45 ? 0.42 : c >= 25 ? 0.32 : 0.22;
  return { pane: 'hexPane', color, weight: 0.9, opacity: 0.55, fillColor: color, fillOpacity: opacity };
}

function buildingStyle(f) {
  const big = Number(f.properties.area_m2 || 0) > 450;
  return { pane: 'buildingPane', color: big ? '#fed7aa' : '#fdba74', weight: big ? 0.8 : 0.48, opacity: 0.95, fillColor: big ? '#ef4444' : '#f97316', fillOpacity: big ? 0.82 : 0.70 };
}

function showStats() {
  const share = stats.areaKm2 ? (stats.areaM2 / 1000000 / stats.areaKm2) * 100 : 0;
  kpiBuildings.textContent = fmt(stats.count);
  kpiFootprint.textContent = fmt(stats.areaM2 / 1000000, 3);
  kpiShare.textContent = fmt(share, 3) + '%';
  kpiHotspots.textContent = fmt(stats.hotspots);
  setInfo(`<b>Chirchiq urban footprint baseline</b><br><span class="muted">Boundary chiziqlar olib tashlandi. Xarita faqat qurilish footprintlari va hexagonal zichlik tahliliga fokuslangan.</span><table class="mini-table"><tr><th>Indikator</th><th>Qiymat</th></tr><tr><td>Bino soni</td><td>${fmt(stats.count)}</td></tr><tr><td>Footprint</td><td>${fmt(stats.areaM2 / 1000000, 3)} km²</td></tr><tr><td>Built-up ulushi</td><td>${fmt(share, 3)}%</td></tr><tr><td>Hex zichlik o‘choqlari</td><td>${fmt(stats.hotspots)}</td></tr></table>`);
}

function render(features) {
  const grid = makeHexGrid(features);
  stats = { count: features.length, areaM2: features.reduce((s, f) => s + f.properties.area_m2, 0), areaKm2: bboxAreaKm2(AREA.bbox), hotspots: grid.features.length };

  hexLayer = L.geoJSON(grid, {
    style: hexStyle,
    onEachFeature: (f, l) => l.on('click', () => setDetails(`<b>Hexagonal qurilish zichligi</b><br>Bino soni: ${fmt(f.properties.count)}<br>Footprint yig‘indisi: ${fmt(f.properties.area, 1)} m²<br><span class="muted">Hex grid urban concentration indikatoridir.</span>`))
  }).addTo(map);

  buildingLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: buildingStyle,
    onEachFeature: (f, l) => {
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
    }
  }).addTo(map);
  buildingLayer.bringToFront();
  showStats();
}

async function init() {
  const bounds = L.latLngBounds([[AREA.bbox[1], AREA.bbox[0]], [AREA.bbox[3], AREA.bbox[2]]]);
  map.fitBounds(bounds, { padding: [40, 40] });
  setInfo('Chirchiq bo‘yicha hexagonal urban analytics yuklanmoqda...');
  const data = await getBuildings();
  const features = (data.elements || []).filter(el => el.type === 'way' && el.geometry).map(toFeature).filter(Boolean);
  render(features);
  setDetails('Bino footprinti yoki hex zichlik o‘chog‘i ustiga bosing. Ma’lumot shu panelda chiqadi.');
  L.control.layers({ 'Night basemap': base }, { 'Hexagonal zichlik': hexLayer, 'Bino footprintlari': buildingLayer }, { collapsed: true }).addTo(map);
}

document.querySelectorAll('[data-focus]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-focus]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  map.fitBounds(L.latLngBounds([[AREA.bbox[1], AREA.bbox[0]], [AREA.bbox[3], AREA.bbox[2]]]), { padding: [40, 40] });
  if (stats) showStats();
}));

init().catch(err => {
  console.error(err);
  setInfo('Xarita yuklashda xatolik: ' + err.message);
  setDetails('Overpass yoki data fayl javob bermadi. Sahifani qayta yangilang.');
});

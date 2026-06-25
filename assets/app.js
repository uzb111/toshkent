const map = L.map('map', { zoomControl: true }).setView([41.19, 69.62], 8);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const info = document.getElementById('info');
let selectedLayer = null;

function districtStyle(feature) {
  const p = feature.properties || {};
  const builtShare = Number(p.built_share_pct || 0);
  const fillOpacity = builtShare > 0 ? Math.min(0.72, 0.12 + builtShare / 60) : 0.12;
  return {
    color: '#7dd3fc', weight: 1.1, opacity: 0.9,
    fillColor: builtShare > 0 ? '#f97316' : '#1f2937', fillOpacity
  };
}

function selectFeature(layer, props) {
  if (selectedLayer) selectedLayer.setStyle(districtStyle(selectedLayer.feature));
  selectedLayer = layer;
  layer.setStyle({ color: '#38bdf8', weight: 3, fillOpacity: 0.35 });
  const rows = [
    `<b>${props.name || 'Hudud'}</b>`,
    `Maydon: ${Number(props.area_km2 || 0).toLocaleString('uz-UZ', { maximumFractionDigits: 1 })} km²`,
    props.building_count ? `Binolar soni: ${Number(props.building_count).toLocaleString('uz-UZ')}` : null,
    props.building_area_km2 ? `Bino footprint maydoni: ${Number(props.building_area_km2).toLocaleString('uz-UZ', { maximumFractionDigits: 2 })} km²` : null,
    props.built_share_pct ? `Built-up ulushi: ${Number(props.built_share_pct).toLocaleString('uz-UZ', { maximumFractionDigits: 2 })}%` : null
  ].filter(Boolean);
  info.innerHTML = rows.join('<br>');
}

async function loadGeoJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} not found`);
  return await res.json();
}

async function init() {
  const districts = await loadGeoJSON('data/toshkent_viloyati_tumanlar.geojson');
  const boundaryLayer = L.geoJSON(districts, {
    style: districtStyle,
    onEachFeature: (feature, layer) => {
      layer.on({
        click: () => selectFeature(layer, feature.properties || {}),
        mouseover: () => layer.setStyle({ weight: 2 }),
        mouseout: () => { if (layer !== selectedLayer) layer.setStyle(districtStyle(feature)); }
      });
      layer.bindTooltip(feature.properties?.name || '', { sticky: true });
    }
  }).addTo(map);
  map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });

  try {
    const buildings = await loadGeoJSON('data/buildings.geojson');
    if (buildings.features && buildings.features.length) {
      L.geoJSON(buildings, {
        style: { color: '#f97316', weight: 0.25, opacity: 0.45, fillColor: '#f97316', fillOpacity: 0.5 },
        interactive: false
      }).addTo(map);
    }
  } catch (e) {
    console.warn('buildings.geojson not loaded yet', e);
  }
}

init().catch(err => {
  console.error(err);
  info.textContent = 'Xarita yuklashda xatolik: ' + err.message;
});

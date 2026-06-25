# Toshkent viloyati — urbanizatsiya va qurilish dinamikasi web map

Bu repo PhD/ilmiy buyurtma uchun **Toshkent viloyati urbanizatsiya va qurilish dinamikasi** web xaritasining boshlang‘ich MVP versiyasi.

## Maqsad

- `Hududlar.zip` ichidagi viloyat va tuman chegaralaridan Toshkent viloyati AOI tayyorlash.
- OSM / Overture / Geofabrik / HOTOSM building footprintlari bilan qurilish zichligini hisoblash.
- Keyingi bosqichda GHSL yoki Sentinel asosida 2010–2015–2020–2025 yillar bo‘yicha urbanizatsiya dinamikasini ko‘rsatish.
- GitHub Pages orqali interaktiv web map chiqarish.

## Hozirgi MVP

Hozir repo ichida:

```text
index.html
assets/app.js
assets/style.css
data/toshkent_viloyati_boundary.geojson
data/toshkent_viloyati_tumanlar.geojson
data/buildings.geojson
scripts/
```

`buildings.geojson` hozir placeholder. Real bino ma’lumoti Overture Maps yoki Geofabrik/HOTOSM orqali yuklanadi.

## Ishga tushirish

Local test:

```bash
python -m http.server 8000
```

Brauzerda ochish:

```text
http://localhost:8000
```

## GitHub Pages

Repo settings ichida:

```text
Settings → Pages → Deploy from a branch → main → /root → Save
```

Keyin xarita quyidagi ko‘rinishda ochiladi:

```text
https://uzb111.github.io/toshkent/
```

## Data manbalari

- Overture Maps Buildings — bbox bo‘yicha building footprint olish uchun.
- Geofabrik Uzbekistan OSM shapefile — `gis_osm_buildings_a_free_1.shp`.
- HOTOSM / HDX Uzbekistan buildings — OSM building export.
- GHSL Built-up Surface — haqiqiy multi-temporal urbanizatsiya dinamikasi uchun.

## Keyingi bosqich

1. Bitta pilot shahar tanlash: Nurafshon, Chirchiq, Angren, Olmaliq yoki Yangiyo‘l.
2. Building footprintlarni yuklab olish.
3. Tuman/shahar kesimida bino soni, footprint maydoni va built-up ulushini hisoblash.
4. GHSL bilan 2010–2015–2020–2025 urban growth qatlamlarini qo‘shish.

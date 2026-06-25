import csv
import json
import time
from pathlib import Path

import requests
from pyproj import Transformer
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[1]
DISTRICTS_PATH = ROOT / "data" / "toshkent_viloyati_tumanlar.geojson"
BUILDINGS_OUT = ROOT / "data" / "buildings.geojson"
STATS_OUT = ROOT / "data" / "building_stats.csv"

TARGET_AREAS = ["Nurafshon", "Chirchiq"]
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
PROJECT = Transformer.from_crs("EPSG:4326", "EPSG:32642", always_xy=True).transform


def fix_geom(geom):
    if geom.is_empty:
        return geom
    if not geom.is_valid:
        geom = make_valid(geom)
    if not geom.is_valid:
        geom = geom.buffer(0)
    return geom


def load_target_districts():
    data = json.loads(DISTRICTS_PATH.read_text(encoding="utf-8"))
    targets = []
    for feature in data["features"]:
        name = feature.get("properties", {}).get("name")
        if name in TARGET_AREAS:
            geom = fix_geom(shape(feature["geometry"]))
            targets.append({"name": name, "feature": feature, "geometry": geom})
    if not targets:
        raise RuntimeError("Target areas were not found in district GeoJSON.")
    return data, targets


def query_overpass(bounds):
    west, south, east, north = bounds
    query = f"""
[out:json][timeout:120];
(
  way[\"building\"]({south},{west},{north},{east});
);
out tags geom;
"""
    last_error = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = requests.post(endpoint, data={"data": query}, timeout=180)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
            print(f"Overpass failed at {endpoint}: {exc}")
            time.sleep(8)
    raise RuntimeError(f"All Overpass endpoints failed: {last_error}")


def way_to_polygon(element):
    coords = [(p["lon"], p["lat"]) for p in element.get("geometry", [])]
    if len(coords) < 4:
        return None
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    try:
        geom = fix_geom(Polygon(coords))
    except Exception:
        return None
    if geom.is_empty:
        return None
    return geom


def area_m2(geom):
    return abs(transform(PROJECT, geom).area)


def main():
    districts_data, targets = load_target_districts()
    all_features = []
    stats_by_name = {}
    seen = set()

    for target in targets:
        geom = target["geometry"]
        west, south, east, north = geom.bounds
        pad = 0.003
        overpass_data = query_overpass((west - pad, south - pad, east + pad, north + pad))
        count = 0
        total_area = 0.0

        for element in overpass_data.get("elements", []):
            osm_id = f"way/{element.get('id')}"
            if osm_id in seen:
                continue
            poly = way_to_polygon(element)
            if poly is None:
                continue
            clipped = fix_geom(poly.intersection(geom))
            if clipped.is_empty:
                continue
            clipped_area = area_m2(clipped)
            if clipped_area < 8:
                continue
            seen.add(osm_id)
            count += 1
            total_area += clipped_area
            tags = element.get("tags", {})
            all_features.append({
                "type": "Feature",
                "properties": {
                    "osm_id": osm_id,
                    "building": tags.get("building", "yes"),
                    "name": tags.get("name"),
                    "pilot_area": target["name"],
                    "area_m2": round(clipped_area, 2),
                    "source": "OpenStreetMap Overpass API"
                },
                "geometry": mapping(clipped)
            })

        stats_by_name[target["name"]] = {
            "building_count": count,
            "building_area_m2": total_area,
            "building_area_km2": total_area / 1_000_000,
        }
        print(f"{target['name']}: {count} buildings, {total_area / 1_000_000:.4f} km2 footprint")

    for feature in districts_data["features"]:
        props = feature.get("properties", {})
        stats = stats_by_name.get(props.get("name"))
        if not stats:
            continue
        area_km2_value = float(props.get("area_km2") or 0)
        props["building_count"] = stats["building_count"]
        props["building_area_m2"] = round(stats["building_area_m2"], 2)
        props["building_area_km2"] = round(stats["building_area_km2"], 6)
        props["building_density_per_km2"] = round(stats["building_count"] / area_km2_value, 3) if area_km2_value else 0
        props["built_share_pct"] = round((stats["building_area_km2"] / area_km2_value) * 100, 6) if area_km2_value else 0

    BUILDINGS_OUT.write_text(json.dumps({"type": "FeatureCollection", "features": all_features}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    DISTRICTS_PATH.write_text(json.dumps(districts_data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    with STATS_OUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["name", "building_count", "building_area_m2", "building_area_km2", "building_density_per_km2", "built_share_pct"])
        for feature in districts_data["features"]:
            props = feature.get("properties", {})
            if props.get("name") in stats_by_name:
                writer.writerow([
                    props.get("name"),
                    props.get("building_count", 0),
                    props.get("building_area_m2", 0),
                    props.get("building_area_km2", 0),
                    props.get("building_density_per_km2", 0),
                    props.get("built_share_pct", 0),
                ])

    print(f"Wrote {len(all_features)} building features to {BUILDINGS_OUT}")


if __name__ == "__main__":
    main()

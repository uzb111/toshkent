from pathlib import Path
import geopandas as gpd

DISTRICTS = Path("../data/toshkent_viloyati_tumanlar.geojson")
BUILDINGS = Path("../data/buildings.geojson")
OUT_GEOJSON = Path("../data/toshkent_viloyati_tumanlar.geojson")
OUT_CSV = Path("../data/building_stats.csv")
AREA_CRS = 32642


def main():
    districts = gpd.read_file(DISTRICTS).to_crs(4326)
    buildings = gpd.read_file(BUILDINGS).to_crs(4326)
    if buildings.empty:
        raise SystemExit("buildings.geojson is empty. Download building data first.")

    d_m = districts.to_crs(AREA_CRS)
    b_m = buildings.to_crs(AREA_CRS)
    b_m["building_area_m2"] = b_m.geometry.area

    joined = gpd.sjoin(
        b_m[["building_area_m2", "geometry"]],
        d_m[["name", "soato", "area_km2", "geometry"]],
        predicate="within",
        how="inner",
    )
    stats = joined.groupby(["name", "soato"], as_index=False).agg(
        building_count=("building_area_m2", "size"),
        building_area_m2=("building_area_m2", "sum"),
    )
    stats["building_area_km2"] = stats["building_area_m2"] / 1_000_000

    out = districts.merge(stats, on=["name", "soato"], how="left")
    for col in ["building_count", "building_area_m2", "building_area_km2"]:
        out[col] = out[col].fillna(0)
    out["building_density_per_km2"] = out["building_count"] / out["area_km2"]
    out["built_share_pct"] = (out["building_area_km2"] / out["area_km2"]) * 100

    out.to_file(OUT_GEOJSON, driver="GeoJSON")
    out.drop(columns="geometry").sort_values("building_count", ascending=False).to_csv(OUT_CSV, index=False)
    print(f"OK: stats saved to {OUT_CSV}")


if __name__ == "__main__":
    main()

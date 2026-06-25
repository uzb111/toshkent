from pathlib import Path
import geopandas as gpd

BUILDINGS_SHP = Path("../raw_osm/geofabrik_unzipped/gis_osm_buildings_a_free_1.shp")
AOI = Path("../data/toshkent_viloyati_boundary.geojson")
OUT = Path("../data/buildings.geojson")


def main():
    aoi = gpd.read_file(AOI).to_crs(4326)
    buildings = gpd.read_file(BUILDINGS_SHP).to_crs(4326)
    minx, miny, maxx, maxy = aoi.total_bounds
    buildings = buildings.cx[minx:maxx, miny:maxy].copy()
    clipped = gpd.overlay(buildings, aoi[["geometry"]], how="intersection", keep_geom_type=True)
    clipped = clipped[clipped.geometry.notna() & ~clipped.geometry.is_empty].copy()
    clipped.to_file(OUT, driver="GeoJSON")
    print(f"OK: {len(clipped)} buildings written to {OUT}")


if __name__ == "__main__":
    main()

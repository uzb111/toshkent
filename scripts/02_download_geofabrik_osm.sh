#!/usr/bin/env bash
set -euo pipefail
mkdir -p ../raw_osm
cd ../raw_osm
# Geofabrik OSM Uzbekistan shapefile extract. Ichida gis_osm_buildings_a_free_1.shp bo‘ladi.
curl -L -o uzbekistan-latest-free.shp.zip https://download.geofabrik.de/asia/uzbekistan-latest-free.shp.zip
unzip -o uzbekistan-latest-free.shp.zip 'gis_osm_buildings_a_free_1.*' -d geofabrik_unzipped

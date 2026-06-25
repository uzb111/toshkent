#!/usr/bin/env bash
set -euo pipefail
# Toshkent viloyati bbox: minLon,minLat,maxLon,maxLat
BBOX="68.6422891,40.1883196,71.2683821,42.2945559"
mkdir -p ../data
python -m pip install --upgrade overturemaps
# Full viloyat katta bo‘lishi mumkin. Avval kichik shahar bbox bilan test qiling.
overturemaps download --bbox="$BBOX" -f geojson --type=building -o ../data/buildings.geojson

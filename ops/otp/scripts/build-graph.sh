#!/usr/bin/env sh
set -eu

DATA_DIR="${PAMILA_OTP_DATA_DIR:-data/otp}"
IMAGE="${PAMILA_OTP_IMAGE:-docker.io/opentripplanner/opentripplanner:latest}"

if [ ! -d "$DATA_DIR" ]; then
  echo "Missing $DATA_DIR. Create it and add osm.pbf, GTFS ZIP files, and OTP config JSON." >&2
  exit 1
fi

if [ ! -f "$DATA_DIR/osm.pbf" ]; then
  echo "Missing $DATA_DIR/osm.pbf. Add a NYC-area OpenStreetMap extract before building." >&2
  exit 1
fi

if ! ls "$DATA_DIR"/*gtfs*.zip >/dev/null 2>&1; then
  echo "Missing GTFS ZIP files. Add MTA static GTFS ZIPs with 'gtfs' in each filename." >&2
  exit 1
fi

if [ ! -f "$DATA_DIR/build-config.json" ] || [ ! -f "$DATA_DIR/router-config.json" ]; then
  echo "Missing OTP config JSON. Copy ops/otp/config/*.json into $DATA_DIR." >&2
  exit 1
fi

docker run --rm \
  -e JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-"-Xmx6g"}" \
  -v "$(pwd)/$DATA_DIR:/var/opentripplanner" \
  "$IMAGE" \
  --build --save

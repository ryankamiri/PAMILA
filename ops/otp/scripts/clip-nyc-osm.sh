#!/usr/bin/env sh
set -eu

DATA_DIR="${PAMILA_OTP_DATA_DIR:-data/otp}"
IMAGE="${PAMILA_OSMIUM_IMAGE:-mschilde/osmium-tool}"
BBOX="${PAMILA_OTP_OSM_BBOX:--74.15,40.45,-73.65,40.98}"
SOURCE="$DATA_DIR/new-york-state.osm.pbf.archive"
TARGET="$DATA_DIR/osm.pbf"

if [ ! -d "$DATA_DIR" ]; then
  echo "Missing $DATA_DIR. Run pnpm otp:download first." >&2
  exit 1
fi

if [ ! -f "$SOURCE" ]; then
  if [ -f "$TARGET" ]; then
    mv "$TARGET" "$SOURCE"
  else
    echo "Missing $SOURCE or $TARGET. Run pnpm otp:download first." >&2
    exit 1
  fi
fi

docker run --rm \
  -w /data \
  -v "$(pwd)/$DATA_DIR:/data" \
  "$IMAGE" \
  osmium extract \
  --bbox="$BBOX" \
  --strategy=complete_ways \
  --input-format=pbf \
  -o osm.pbf \
  new-york-state.osm.pbf.archive \
  --overwrite

echo "Clipped NYC OSM extract is ready at $TARGET"

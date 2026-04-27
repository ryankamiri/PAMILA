#!/usr/bin/env sh
set -eu

DATA_DIR="${PAMILA_OTP_DATA_DIR:-data/otp}"

mkdir -p "$DATA_DIR"

download_if_missing() {
  url="$1"
  target="$2"

  if [ -s "$target" ]; then
    echo "Already have $target"
    return
  fi

  tmp="${target}.part"
  echo "Downloading $url"
  curl --fail --location --continue-at - --output "$tmp" "$url"
  mv "$tmp" "$target"
}

download_if_missing "https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf" "$DATA_DIR/osm.pbf"
download_if_missing "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip" "$DATA_DIR/mta-subway-gtfs.zip"
download_if_missing "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip" "$DATA_DIR/mta-bus-manhattan-gtfs.zip"
download_if_missing "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_b.zip" "$DATA_DIR/mta-bus-brooklyn-gtfs.zip"
download_if_missing "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_q.zip" "$DATA_DIR/mta-bus-queens-gtfs.zip"

cp ops/otp/config/build-config.json "$DATA_DIR/build-config.json"
cp ops/otp/config/router-config.json "$DATA_DIR/router-config.json"

echo "OTP input data is ready in $DATA_DIR"

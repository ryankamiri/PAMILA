#!/usr/bin/env sh
set -eu

DATA_DIR="${PAMILA_OTP_DATA_DIR:-data/otp}"
IMAGE="${PAMILA_OTP_IMAGE:-docker.io/opentripplanner/opentripplanner:latest}"
PORT="${PAMILA_OTP_PORT:-8080}"

if [ ! -d "$DATA_DIR" ]; then
  echo "Missing $DATA_DIR. Build or add an OTP graph before serving." >&2
  exit 1
fi

docker run --rm \
  -p "$PORT:8080" \
  -e JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-"-Xmx4g"}" \
  -v "$(pwd)/$DATA_DIR:/var/opentripplanner" \
  "$IMAGE" \
  --load --serve

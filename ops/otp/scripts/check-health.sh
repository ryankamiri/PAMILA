#!/usr/bin/env sh
set -eu

OTP_BASE_URL="${PAMILA_OTP_BASE_URL:-http://127.0.0.1:8080}"

if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error "$OTP_BASE_URL" >/dev/null
  echo "OTP responded at $OTP_BASE_URL"
else
  echo "curl is required for this health check." >&2
  exit 1
fi

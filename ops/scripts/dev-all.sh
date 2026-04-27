#!/usr/bin/env sh
set -eu

api_pid=""
web_pid=""
otp_pid=""

cleanup() {
  status=$?

  if [ -n "$api_pid" ]; then
    kill "$api_pid" 2>/dev/null || true
  fi
  if [ -n "$web_pid" ]; then
    kill "$web_pid" 2>/dev/null || true
  fi
  if [ -n "$otp_pid" ]; then
    kill "$otp_pid" 2>/dev/null || true
  fi

  exit "$status"
}

trap cleanup INT TERM EXIT

echo "Starting PAMILA API on http://127.0.0.1:7410"
pnpm dev:api &
api_pid=$!

echo "Starting PAMILA web dashboard"
pnpm dev:web &
web_pid=$!

echo "Starting local OpenTripPlanner"
sh ops/otp/scripts/run-server.sh &
otp_pid=$!

wait "$api_pid" "$web_pid" "$otp_pid"

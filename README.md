# PAMILA

PAMILA means "Please assist me in locating apartments." It is a personal local dashboard for finding NYC summer housing from Airbnb and Leasebreak, ranking listings against the Ramp internship constraints, and keeping the search from turning into browser-tab soup.

## What It Does

- Saves Airbnb and Leasebreak listings through manual entry or the Chrome capture helper.
- Stores listings locally in SQLite.
- Scores listings with the PAMILA rubric: commute, Manhattan/location, price, dates, amenities, and stay/bed fit.
- Tracks cleanup actions, risk flags, notes, status, shortlist/finalist state, and exports.
- Shows saved coordinates on a Leaflet/OpenStreetMap pin map with Ramp marked.
- Calculates transit commute through a local OpenTripPlanner service when you have OTP data running.
- Falls back to manual commute entry when OTP is unavailable.
- Optionally enriches captured listing text with OpenAI when enabled.

No Google Maps API key or paid maps API is required.

## Local Setup

Install dependencies:

```sh
pnpm install
```

Create local environment values:

```sh
cp .env.example .env
```

The defaults are intentionally local-friendly. If you keep `dev-local-token`, the API, web app, and extension will all agree without extra setup.

For non-default values, export them in the shell before starting the API/web processes:

```sh
set -a
source .env
set +a
```

Important env values:

```sh
PAMILA_API_HOST=127.0.0.1
PAMILA_API_PORT=7410
PAMILA_WEB_ORIGIN=http://localhost:5173
PAMILA_LOCAL_TOKEN=dev-local-token
VITE_PAMILA_LOCAL_TOKEN=dev-local-token
PAMILA_DATABASE_URL=file:data/pamila.sqlite
PAMILA_OTP_URL=http://127.0.0.1:8080/otp/gtfs/v1
PAMILA_GEOCODER_URL=https://nominatim.openstreetmap.org/search
OPENAI_API_KEY=
PAMILA_OPENAI_MODEL=gpt-5
```

Start the API:

```sh
pnpm dev:api
```

Start the web app:

```sh
pnpm dev:web
```

Open:

```text
http://localhost:5173
```

The API health endpoint is:

```text
http://127.0.0.1:7410/health
```

## Daily Workflow

1. Open PAMILA.
2. Add a listing manually or capture one from Airbnb/Leasebreak.
3. Clean missing price, dates, stay type, bedroom, location, and amenities in Inbox or Listing Detail.
4. Save or geocode the location.
5. Use Map/Commute to compare mapped listings around Ramp.
6. Calculate OTP commute if local OTP is running, or enter commute manually.
7. Shortlist, contact, reject, or mark finalist.
8. Export CSV or JSON backup from Settings/header actions.

## Chrome Capture Helper

Build the extension:

```sh
pnpm --filter @pamila/extension build
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click "Load unpacked".
4. Select `/Users/ramiri/dev/projects/PAMILA/apps/extension`.
5. Open the extension options page.
6. Set API URL to `http://127.0.0.1:7410`.
7. Set token to `dev-local-token` unless you changed `PAMILA_LOCAL_TOKEN`.

Use it by opening an Airbnb or Leasebreak listing page and clicking the PAMILA extension button. It captures only the page you are viewing. It does not crawl search results or background-fetch other listing pages.

## Map And Geocoding

The map uses Leaflet with public OpenStreetMap tiles and attribution. Use it normally and lightly; do not bulk-download or scrape tiles.

Geocoding is user-triggered per listing through the Geocode button. PAMILA uses the configured `PAMILA_GEOCODER_URL`, defaulting to public Nominatim search. Keep this light and manual: do not bulk-geocode every listing at once.

If geocoding misses, enter latitude/longitude manually in the Listing Detail location editor.

## OpenTripPlanner

PAMILA can calculate subway/bus/walk commute when a local OTP server is running. OTP data is large, so setup is explicit and user-triggered.

Follow:

```text
ops/otp/README.md
```

Short version:

```sh
mkdir -p data/otp
cp ops/otp/config/build-config.json data/otp/build-config.json
cp ops/otp/config/router-config.json data/otp/router-config.json
```

Add a NYC OSM `.pbf` and MTA GTFS ZIP files to `data/otp/`, then run:

```sh
sh ops/otp/scripts/build-graph.sh
sh ops/otp/scripts/run-server.sh
```

Check OTP:

```sh
sh ops/otp/scripts/check-health.sh
```

If OTP is down or lacks a route, PAMILA keeps manual commute entry usable.

## Optional OpenAI Capture Analysis

OpenAI analysis is off by default. To enable it:

1. Create an API key in the OpenAI platform.
2. Set `OPENAI_API_KEY` in your shell environment or `.env` workflow.
3. Keep `PAMILA_OPENAI_MODEL=gpt-5` unless you want to override it.
4. Turn on "LLM capture analysis" in PAMILA Settings.

Useful official docs:

- OpenAI API keys and quickstart: <https://platform.openai.com/docs/quickstart>
- OpenAI API authentication: <https://platform.openai.com/docs/api-reference/introduction>

The API key is only used by the local API. Do not put it into the Chrome extension settings or client-side code.

## Tests

Run all unit/API/UI tests:

```sh
pnpm test
```

Run typechecking:

```sh
pnpm typecheck
```

Build everything:

```sh
pnpm build
```

Run the Playwright smoke test:

```sh
pnpm test:e2e
```

The e2e test starts or reuses local API/web servers and stores smoke-test data in `data/pamila-e2e.sqlite`.

## Local Data

Runtime data lives under `data/` and is ignored by git. Back up listings from the app with the JSON export before deleting local databases.

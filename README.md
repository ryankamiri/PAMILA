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
PAMILA_OTP_ARRIVAL_DATE_TIME=2026-05-06T09:00:00-04:00
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

If Vite says port `5173` is already busy, open the local URL it prints instead. PAMILA allows loopback browser origins for local development.

The API health endpoint is:

```text
http://127.0.0.1:7410/health
```

After OTP has been downloaded and built once, you can run the API, web app, and OTP together:

```sh
pnpm dev:all
```

That command starts the API, Vite dashboard, and local OpenTripPlanner in one terminal. Press `Ctrl-C` once to stop all three.

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

For extension development, keep a compile watcher running:

```sh
pnpm dev:extension
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click "Load unpacked".
4. Select `/Users/ramiri/dev/projects/PAMILA/apps/extension`.
5. Open the extension options page.
6. Set API URL to `http://localhost:7410`.
7. Set Local API token to `dev-local-token` unless you changed `PAMILA_LOCAL_TOKEN`.

The token is the small shared secret the Chrome extension sends to the local API. In the default `.env.example`, the API uses:

```sh
PAMILA_LOCAL_TOKEN=dev-local-token
```

So the extension options should use:

```text
Local API URL: http://localhost:7410
Local API token: dev-local-token
```

If you change `PAMILA_LOCAL_TOKEN` in `.env` or your shell, put that exact same value in the extension options page. Leave the OpenAI API key out of the extension; OpenAI keys stay server-side only.

Click "Test connection" on the options page after saving. It should say connected when the local API is running and the token matches. If it says token issue, copy the exact `PAMILA_LOCAL_TOKEN` value into the extension. If it says API offline, start `pnpm dev:api`.

When extension code changes, `pnpm dev:extension` recompiles the `dist/` files automatically, but Chrome still needs the unpacked extension reloaded. Use the "Reload extension" button on the options page or the reload icon on `chrome://extensions`, then refresh any open Airbnb/Leasebreak tabs so the newest content script appears.

Use it from Airbnb or Leasebreak:

1. Open Airbnb or Leasebreak.
2. Look for the floating PAMILA helper in the lower-right corner.
3. On search/results pages, use the helper checklist and open one promising listing. PAMILA intentionally does not batch-capture visible search cards.
4. On a specific listing page, click the compact "Save to PAMILA" button for quick capture.
5. Use the "PAMILA" pill when you want the full helper panel, API status, troubleshooting, or the dashboard link.
6. After saving, the quick button changes to "Already in PAMILA". Use "Open Inbox" or "Open Details" to jump back to the dashboard.

The helper appears on `airbnb.com`, `www.airbnb.com`, `leasebreak.com`, and `www.leasebreak.com`. The toolbar extension button still works as a fallback on specific listing pages. It captures only the page you are viewing. It does not crawl search results, background-fetch other listing pages, or click filters for you.

Saved-state behavior:

- PAMILA checks the local API to see whether an Airbnb listing is already saved.
- After refresh, a saved Airbnb listing page should show "Already in PAMILA" instead of offering another duplicate save.
- Airbnb search/results pages may show small green "In PAMILA" badges on visible card photos you have already saved. The helper panel also says how many visible cards matched saved listings.
- If the API is offline, the extension can still show known saved listings from its local Chrome-storage cache, then confirm again once the API is back.

Dead-link cleanup:

- Use the dashboard header button "Clean dead links" when old Airbnb or Leasebreak listings are cluttering the app.
- The cleanup is user-triggered and conservative: it removes only source links that clearly return `404` or `410`.
- If a source blocks the check, rate-limits it, times out, or returns a server error, PAMILA leaves the listing alone and shows a warning instead of deleting it.

Recommended Airbnb search checklist before opening a listing: NYC/Manhattan area, June 30 or July 1 through September 12, entire place, and around `$3,600` monthly max. For Leasebreak, pay close attention to earliest/latest move-in and move-out windows before saving.

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
pnpm otp:download
pnpm otp:clip-osm
pnpm otp:build
pnpm otp:run
```

`pnpm otp:download` downloads a New York OpenStreetMap extract and MTA static GTFS feeds into `data/otp/`. `pnpm otp:build` uses Docker to build the local OTP graph. `pnpm otp:run` serves the graph on `http://127.0.0.1:8080`.

`pnpm otp:clip-osm` trims the New York State OSM extract down to the NYC area before building. Keep this step unless you have a very large Docker memory limit; the full state extract is much more likely to get killed during graph build. The original extract is kept with an `.archive` suffix so OTP does not try to read it.

The default OTP commute date is `2026-05-06T09:00:00-04:00`, a representative Wednesday morning within the current MTA static feed window. When MTA publishes summer GTFS covering the actual internship dates, update `PAMILA_OTP_ARRIVAL_DATE_TIME` and rebuild OTP.

Check OTP:

```sh
pnpm otp:health
```

Once `pnpm otp:build` succeeds, the everyday command is:

```sh
pnpm dev:all
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

The e2e test starts isolated API/web servers on `17410` and `15173`, and stores smoke-test data in `data/pamila-e2e.sqlite`. It should not reuse or write to your normal local API on `7410`.

## Local Data

Runtime data lives under `data/` and is ignored by git. Back up listings from the app with the JSON export before deleting local databases.

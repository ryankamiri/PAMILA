# PAMILA Technical Design Doc

This document turns the product design in `product-design-doc.md` into an implementation blueprint. It specifies the first technical version of PAMILA as a personal local app for apartment search curation, not a production SaaS product.

PAMILA should be useful before it is fully automated. The first milestone is a working local dashboard with manual listing entry, filters, deterministic scoring, notes, status tracking, map support, and exports. The Chrome capture helper, local transit engine, and optional OpenAI enrichment build on that foundation.

## Goals

- Build a local-only apartment curation app for one user.
- Support Airbnb and Leasebreak as the only source sites.
- Avoid paid APIs and paid SaaS dependencies.
- Prefer capture-plus-cleanup over brittle automated source crawling.
- Rank listings with deterministic, explainable rules.
- Support a required map view and local transit routing.
- Keep the system easy to run, inspect, export, and change.

## Non-Goals

- No public hosting.
- No multi-user accounts.
- No paid listing feeds.
- No automated Airbnb or Leasebreak search bots in v1.
- No background crawling of source sites.
- No email, SMS, or OS-level notifications in v1.
- No source-site messaging automation.
- No redistribution of cached listing photos.

## System Overview

PAMILA is a local TypeScript app with five main parts:

1. React dashboard
2. Fastify local API
3. SQLite database with Drizzle ORM
4. Chrome extension for listing capture
5. Local OpenTripPlanner service for transit routing

Optional parts:

- OpenAI-assisted listing analysis
- thumbnail cache
- CSV/JSON export and restore

```text
Chrome / Browser
  |
  | save listing, paste URL, edit fields
  v
React Dashboard  <---->  Fastify API  <---->  SQLite
                                  |
                                  | optional
                                  v
                            OpenAI Responses API
                                  |
                                  | routing requests
                                  v
                         OpenTripPlanner Docker
                                  |
                                  v
                          OSM + MTA GTFS data
```

## Stack Decisions

### App Runtime

- Package manager: `pnpm`
- Language: TypeScript
- Node: use the local modern Node runtime already available on the machine
- Frontend: Vite + React
- Backend: Fastify
- Database: SQLite
- Database access: Drizzle ORM and Drizzle migrations
- UI styling: Tailwind CSS with local reusable components
- Map UI: Leaflet or MapLibre-compatible React wrapper using public OSM tiles with attribution
- Extension: Chrome Manifest V3
- Transit routing: Dockerized OpenTripPlanner

### Repository Layout

The implementation should use a small workspace layout:

```text
apps/
  web/          React dashboard
  api/          Fastify local API
  extension/    Chrome capture helper
packages/
  core/         shared types, scoring, filters, date logic
  db/           Drizzle schema, migrations, seed/default settings
  ui/           shared React components if needed
ops/
  otp/          OpenTripPlanner Docker config and data scripts
data/           local runtime data, gitignored
```

The design docs stay at the repo root:

```text
product-design-doc.md
technical-design-doc.md
```

### Local Runtime Defaults

- Web app: `http://localhost:5173`
- API: `http://localhost:7410`
- OpenTripPlanner: `http://localhost:8080`
- SQLite file: `data/pamila.sqlite`
- Media thumbnails: `data/media/thumbnails/`
- Exports: `data/exports/`
- OTP data/cache: `data/otp/`

All `data/` contents should be ignored by git.

## Configuration

Use environment variables for local configuration:

```text
PAMILA_API_HOST=127.0.0.1
PAMILA_API_PORT=7410
PAMILA_WEB_ORIGIN=http://localhost:5173
PAMILA_LOCAL_TOKEN=<generated local shared token>
PAMILA_DATABASE_URL=file:data/pamila.sqlite
PAMILA_OTP_URL=http://localhost:8080
PAMILA_ENABLE_AI=false
OPENAI_API_KEY=<optional>
OPENAI_MODEL=<required only when AI is enabled>
```

Rules:

- The API binds to localhost only.
- All `/api/*` endpoints require `X-PAMILA-Token`.
- The Chrome extension stores the same local token in extension storage.
- AI is disabled unless `PAMILA_ENABLE_AI=true`, `OPENAI_API_KEY` is present, and `OPENAI_MODEL` is set.
- The app must start and work without OpenAI configured.

## Data Model

This section defines table responsibilities, not final migration syntax. Drizzle migrations should encode these tables with explicit enums where useful and timestamps for auditability.

### `settings`

Stores current search settings.

Fields:

- `id`
- `office_name`
- `office_address`
- `office_lat`
- `office_lng`
- `target_start_primary`
- `target_start_secondary`
- `target_end`
- `max_monthly_rent`
- `default_bedroom_filter`
- `normal_stay_type`
- `fallback_stay_type`
- `ideal_commute_minutes`
- `acceptable_commute_minutes`
- `long_walk_minutes`
- `heavy_walk_minutes`
- `panic_mode_enabled`
- `ai_on_capture_enabled`
- `created_at`
- `updated_at`

Default values:

- office: Ramp, 28 West 23rd Street, Floor 2, New York, NY 10010
- target starts: June 30, 2026 and July 1, 2026
- target end: September 12, 2026
- max monthly rent: 3600
- default bedroom filter: studio or 1BR
- normal stay type: entire apartment
- fallback stay type: private room
- ideal commute: 20 minutes
- acceptable commute: 35 minutes
- long walk: over 10 minutes
- heavy walk: over 15 minutes

### `listings`

Stores the user-facing listing record.

Fields:

- `id`
- `source`: `airbnb` or `leasebreak`
- `source_url`
- `canonical_source_url`
- `title`
- `monthly_rent`
- `known_total_fees`
- `stay_type`: `entire_apartment`, `private_room`, `shared_room`, `unknown`
- `bedroom_count`
- `bedroom_label`
- `bathroom_type`: `private`, `shared`, `unknown`
- `kitchen`: `yes`, `no`, `unknown`
- `washer`: `in_unit`, `in_building`, `nearby`, `no`, `unknown`
- `furnished`: `yes`, `no`, `unknown`
- `availability_summary`
- `earliest_move_in`
- `latest_move_in`
- `earliest_move_out`
- `latest_move_out`
- `month_to_month`
- `status`
- `user_notes`
- `next_action`
- `created_at`
- `updated_at`

Status values:

- `new`
- `needs_cleanup`
- `ready_to_review`
- `shortlisted`
- `contacted`
- `waiting_for_response`
- `rejected_by_user`
- `rejected_by_host`
- `no_longer_available`
- `finalist`
- `chosen`

### `source_captures`

Stores raw capture records from paste/import or the Chrome extension.

Fields:

- `id`
- `listing_id`
- `source`
- `url`
- `captured_title`
- `captured_text`
- `selected_text`
- `visible_fields_json`
- `thumbnail_candidates_json`
- `page_hash`
- `capture_method`: `manual_paste`, `extension`, `manual_form`
- `captured_at`

The app should preserve raw capture data so parsing can improve later without losing the original source context.

### `locations`

Stores the best available location signal.

Fields:

- `id`
- `listing_id`
- `label`
- `address`
- `cross_streets`
- `neighborhood`
- `borough_or_area`
- `lat`
- `lng`
- `location_source`: `exact_address`, `cross_streets`, `airbnb_approx_pin`, `neighborhood`, `manual_guess`
- `confidence`: `exact`, `high`, `medium`, `low`
- `is_user_confirmed`
- `created_at`
- `updated_at`

Policy:

- Airbnb may use approximate pins without score penalty.
- Airbnb listings must show visible location confidence because exact address is unavailable until booking.
- Leasebreak should prefer exact address or cross streets when available.
- Listings can be scored with approximate locations, but commute labels must disclose estimate quality.

### `commute_estimates`

Stores route results to Ramp.

Fields:

- `id`
- `listing_id`
- `location_id`
- `routing_provider`: `opentripplanner`, `manual`, `external_link`
- `arrival_time_local`
- `total_minutes`
- `walk_minutes`
- `transfer_count`
- `transit_modes_json`
- `route_summary`
- `line_names_json`
- `has_bus_heavy_route`
- `otp_response_hash`
- `external_directions_url`
- `confidence`: `exact`, `estimated`, `manual`
- `created_at`
- `updated_at`

Default route scoring uses weekday arrival at Ramp around 9:00 AM.

### `score_breakdowns`

Stores deterministic scoring output.

Fields:

- `id`
- `listing_id`
- `total_score`
- `commute_score`
- `location_score`
- `price_score`
- `date_score`
- `amenity_score`
- `stay_bedroom_score`
- `hard_filter_status`: `included`, `excluded`, `fallback_only`, `needs_cleanup`
- `hard_filter_reasons_json`
- `score_explanation`
- `cleanup_actions_json`
- `risk_flags_json`
- `scored_at`

Unknown fields create cleanup actions and visual warnings. They do not reduce score unless they block hard eligibility.

### `media_thumbnails`

Stores one local representative thumbnail per listing.

Fields:

- `id`
- `listing_id`
- `source_url`
- `local_path`
- `width`
- `height`
- `content_hash`
- `captured_at`

Rules:

- Cache one thumbnail per listing for personal local comparison.
- Keep the original source URL with the thumbnail record.
- Do not build a full redistributed listing photo archive.
- If thumbnail capture fails, the listing still works.

### `ai_analyses`

Stores optional AI analysis results.

Fields:

- `id`
- `listing_id`
- `source_capture_id`
- `model`
- `input_hash`
- `suggested_fields_json`
- `risk_flags_json`
- `suggested_questions_json`
- `summary`
- `token_usage_json`
- `created_at`

Policy:

- AI suggestions are advisory.
- AI never overrides user-confirmed fields silently.
- Hard filters and PAMILA Score use deterministic fields, not raw AI guesses.
- AI output can create cleanup actions such as "confirm private bathroom" or "ask if July 1 start is acceptable."

### `status_events`

Tracks listing history.

Fields:

- `id`
- `listing_id`
- `from_status`
- `to_status`
- `note`
- `created_at`

### `exports`

Tracks generated export files.

Fields:

- `id`
- `format`: `csv` or `json`
- `local_path`
- `created_at`

## API Surface

All API routes except health checks require:

```text
X-PAMILA-Token: <local token>
```

### Health

- `GET /health`
  - returns service status without sensitive data

### Settings

- `GET /api/settings`
  - returns current settings
- `PUT /api/settings`
  - updates settings and triggers optional score refresh

### Listings

- `GET /api/listings`
  - query params: `source`, `status`, `panicMode`, `bedrooms`, `maxRent`, `q`, `sort`
  - returns listing cards with current score and primary location/commute summary
- `POST /api/listings`
  - creates a manual listing
- `GET /api/listings/:id`
  - returns full listing detail
- `PATCH /api/listings/:id`
  - updates user-editable fields
- `DELETE /api/listings/:id`
  - soft-deletes or archives the listing; do not hard-delete by default

### Captures

- `POST /api/captures`
  - used by paste/import and Chrome extension
  - accepts source, URL, title, visible fields, selected text, page text, approximate location, and thumbnail candidates
  - deduplicates by canonical source URL and page hash
  - creates or updates a listing, stores raw capture, creates cleanup actions, and optionally queues AI analysis

### Scoring

- `POST /api/listings/:id/recalculate-score`
  - recalculates score for one listing
- `POST /api/scores/recalculate`
  - recalculates scores for all active listings

### Location And Routing

- `POST /api/geocode`
  - geocodes user-entered address/cross streets/neighborhood
  - must use cache before external geocoding
- `POST /api/listings/:id/location`
  - creates or updates the listing location
- `POST /api/listings/:id/commute`
  - calculates or updates commute estimate
  - uses OTP when available, otherwise stores manual/external-link commute data

### AI

- `POST /api/listings/:id/analyze`
  - runs optional OpenAI analysis for one listing
  - no-op with clear error if AI is disabled or config is missing
- `GET /api/listings/:id/ai-analyses`
  - returns cached AI analyses

### Media

- `POST /api/listings/:id/thumbnail`
  - stores or updates the representative thumbnail
- `GET /api/media/thumbnails/:id`
  - serves local thumbnails to the dashboard

### Exports

- `GET /api/exports/listings.csv`
  - exports active listings for spreadsheet review
- `GET /api/exports/backup.json`
  - exports full backup data
- `POST /api/import/backup`
  - restores from PAMILA JSON backup after validation

## Chrome Extension

The v1 browser helper targets Chrome only.

### Extension Responsibilities

- Add a "Save to PAMILA" action on Airbnb and Leasebreak listing pages.
- Capture the current page URL and title.
- Detect source as Airbnb or Leasebreak.
- Capture visible listing-like fields when available.
- Capture selected text if the user highlights relevant listing text before saving.
- Capture page text within reasonable size limits.
- Capture thumbnail candidates from visible images.
- Capture approximate Airbnb map/pin data when available in the page DOM or visible metadata.
- Send a single payload to the local API.

### Extension Non-Responsibilities

- Do not crawl Airbnb or Leasebreak search results.
- Do not open source pages in the background.
- Do not bypass anti-bot protections.
- Do not maintain its own database.
- Do not scrape every image on a page.

### Capture Payload Shape

```json
{
  "source": "airbnb",
  "url": "https://example.com/listing",
  "title": "Listing title",
  "visibleFields": {
    "priceText": "$3,400 month",
    "stayTypeText": "Entire rental unit",
    "bedroomText": "Studio",
    "locationText": "Chelsea, New York"
  },
  "selectedText": "",
  "pageText": "bounded visible page text",
  "approxLocation": {
    "label": "Chelsea",
    "lat": 40.74,
    "lng": -73.99,
    "confidence": "medium"
  },
  "thumbnailCandidates": [
    {
      "url": "https://...",
      "width": 800,
      "height": 600
    }
  ],
  "capturedAt": "2026-04-16T12:00:00.000Z"
}
```

The API validates and normalizes this payload before writing to the database.

## Source Handling

### No Search Bots In V1

The user browses Airbnb and Leasebreak directly. PAMILA captures pages the user opens and chooses to save.

Rationale:

- It avoids brittle source-site automation.
- It avoids accidentally building a crawler.
- It gets value from scoring and curation faster.
- It keeps Airbnb handling more reliable because Airbnb pages and availability data can be dynamic.

### Airbnb

Airbnb handling should support:

- entire apartment
- private room
- shared or unclear stay type
- approximate map/pin location
- pricing text and monthly equivalent when visible
- amenities from visible text when available
- thumbnail candidate

Important policy:

- Airbnb exact addresses are unavailable until booking.
- Approximate Airbnb pins do not receive a score penalty.
- The UI must label Airbnb commute estimates as based on approximate location.
- Private rooms are hidden unless Panic/Fallback Mode is enabled.

### Leasebreak

Leasebreak handling should support:

- exact or approximate location
- earliest move-in
- latest move-in
- earliest move-out
- latest move-out
- immediate move-in
- month-to-month terms
- listing price
- bedroom count
- lease/sublet status where visible

Important policy:

- Do not treat a technically valid date window as perfect if the listing emphasizes immediate or very early move-in.
- Keep those listings eligible when the latest move-in and move-out windows work.
- Apply date-risk labels and ask the user to confirm whether a July 1 start is acceptable.

## Location, Maps, And Geocoding

### Location Confidence

PAMILA supports these location sources:

- exact address
- cross streets
- Airbnb approximate pin
- neighborhood
- manual guess

Location confidence is visible in the UI and stored in the database.

Finalist status requires:

- confirmed price
- confirmed/plausible date fit
- confirmed stay type
- best available location for that source

For Airbnb, best available location can be an approximate pin. Exact address is not required.

### Geocoding

Use cached geocoding first. For light user-triggered geocoding, Nominatim can be used with strict limits and local caching.

Rules:

- Do not bulk geocode.
- Do not geocode source search results automatically.
- Cache every geocoding result.
- Let the user manually correct bad geocodes.
- Store attribution and comply with Nominatim usage policy.

### Map View

The map view is required in v1.

Map behavior:

- Show listing pins.
- Color pins by hard filter status or score band.
- Show Ramp office marker.
- Show location confidence in pin popovers.
- Show route summary when a commute estimate exists.
- Link back to listing detail.

Tile behavior:

- Use public OSM tiles only for normal interactive viewing.
- Include OpenStreetMap attribution.
- Do not bulk download tiles.
- Do not use public OSM tiles for offline tile scraping.

## Local Transit Routing

Use OpenTripPlanner locally because it supports transit routing with OpenStreetMap and GTFS data. The implementation should run OTP through Docker and use local OSM + MTA GTFS inputs.

### Data Inputs

- OpenStreetMap extract for NYC area.
- MTA static GTFS feeds for subway and bus.
- Office destination coordinates for Ramp.

The setup should include scripts under `ops/otp/` to download and cache the free routing data. Downloads are one-time or user-triggered, not automatic on every app start.

### Routing Defaults

- Destination: Ramp, 28 West 23rd Street, Floor 2, New York, NY 10010
- Default commute time: weekday arrival around 9:00 AM
- Modes: subway, bus, walking
- Scoring includes total time, transfers, walk time, and bus-heavy route flag

### Routing Fallbacks

If OTP is unavailable:

- show a clear "routing unavailable" state
- allow manual commute entry
- generate external Google Maps web direction links without using a paid API
- keep listings usable and scoreable with manual commute data

## Scoring And Filters

PAMILA Score is deterministic and explainable. It is recalculated whenever relevant listing, location, commute, or settings fields change.

### Hard Filters

Hard filters run before scoring:

- source must be Airbnb or Leasebreak
- advertised monthly rent must be at or below $3,600
- listing must plausibly cover June 30/July 1 through September 12
- stay type must be entire apartment in normal mode
- private rooms are fallback-only unless Panic/Fallback Mode is enabled
- listings clearly over 35 minutes are hidden or heavily marked unless fallback mode is enabled

Hard-filter output:

- `included`
- `excluded`
- `fallback_only`
- `needs_cleanup`

### 100-Point Score

Use this scoring rubric:

```text
Commute quality:       35
Manhattan/location:    20
Price fit:             15
Date fit:              15
Amenities:             10
Stay/bedroom fit:       5
Total:                100
```

Ranking priority after hard eligibility:

1. commute quality
2. Manhattan/location preference
3. price

### Commute Quality: 35 Points

Total commute time:

- 20 minutes or less: 20 points
- 21 to 30 minutes: 15 points
- 31 to 35 minutes: 8 points
- over 35 minutes: 0 points and fallback/heavy warning

Transfers:

- 0 transfers: 6 points
- 1 transfer: 4 points
- 2 transfers: 1 point
- more than 2 transfers: 0 points

Walk to transit:

- 10 minutes or less: 6 points
- 11 to 15 minutes: 2 points
- over 15 minutes: 0 points

Route mode:

- subway-heavy or simple transit route: 3 points
- bus as short connector only: 2 points
- bus-heavy main leg: 0 points

### Manhattan/Location: 20 Points

- Manhattan: 20 points
- LIC/Astoria: 14 points
- Brooklyn: 8 points
- other areas: 2 points

Airbnb approximate pins do not lose location points solely because they are approximate. The UI still labels them as approximate.

### Price Fit: 15 Points

- $2,800 or less: 15 points
- $2,801 to $3,200: 12 points
- $3,201 to $3,450: 9 points
- $3,451 to $3,600: 6 points
- over $3,600: hard excluded

### Date Fit: 15 Points

- exact June 30/July 1 through September 12 or later: 15 points
- starts a few days early and covers the full stay: 13 points
- month-to-month with strong evidence of full-period availability: 10 points
- Leasebreak window technically works but earliest move-in/immediate preference creates risk: 8 points
- date fields are missing but plausibly eligible: 6 points and cleanup action
- starts after July 1 or ends before September 12: hard excluded

Date uncertainty gets a moderate penalty. It should not bury otherwise excellent listings, but confirmed-date listings should beat similar risky-date listings.

### Amenities: 10 Points

Amenities are mostly tie-breakers and cleanup prompts.

Recommended scoring when fields are known:

- kitchen confirmed: 3 points
- private bathroom confirmed or entire apartment: 3 points
- washer in unit or building: 2 points
- furnished confirmed: 2 points

Unknown fields:

- create cleanup actions
- are shown as unknown in the UI
- do not reduce score unless they block eligibility

Implementation note: unknown amenities should receive neutral provisional credit, not a subtraction. Mark the score as provisional and ask the user to confirm the field. If the field is later confirmed as negative, recalculate the amenity score normally.

### Stay/Bedroom Fit: 5 Points

- entire apartment matching studio or 1BR default filter: 5 points
- entire apartment matching a user-selected bedroom filter: 5 points
- entire apartment with unknown bedroom count: 5 provisional points and cleanup action if the listing otherwise plausibly matches the active filter
- private room: fallback-only in normal mode; score only in Panic/Fallback Mode
- shared room: excluded unless the user later explicitly allows it

If the active bedroom filter is exact and the listing cannot plausibly match without more data, mark the listing `needs_cleanup` instead of silently lowering the score.

## Daily Queue Logic

Daily Queue should generate action cards from listing state.

Priority order:

1. high-score listings ready to review
2. high-potential listings blocked by one missing field
3. listings needing date confirmation
4. listings needing location/commute confirmation
5. contacted listings waiting for response
6. obvious rejects to archive
7. fallback/private-room candidates when Panic/Fallback Mode is enabled

Examples:

- "Review this today: 91 score, Manhattan, 18 min commute."
- "Ask whether July 1 start is acceptable."
- "Confirm approximate Airbnb pin before trusting commute."
- "Reject: rent is over $3,600 hard cap."
- "Move to fallback: private room hidden in normal mode."

## Optional OpenAI Assistant

OpenAI is optional and should never be required for the app to run.

Use the OpenAI Responses API for text analysis when AI is enabled. The app should send bounded listing text and ask for structured JSON suggestions. OpenAI guidance should be treated as advisory, not authoritative.

AI trigger:

- run on capture when `ai_on_capture_enabled` is true
- cache by source URL and page-text hash
- do not re-run if cached analysis exists for the same input hash
- expose token/usage metadata in the listing detail or settings area

AI can suggest:

- parsed price
- stay type
- bedroom count
- date clues
- amenities
- risk flags
- questions to ask host/landlord
- short listing summary

AI cannot:

- bypass hard filters
- silently overwrite user-confirmed fields
- produce final PAMILA Score directly
- decide that a listing is safe when deterministic data says otherwise

Suggested output contract:

```json
{
  "suggestedFields": {
    "monthlyRent": 3400,
    "stayType": "entire_apartment",
    "bedroomLabel": "studio",
    "kitchen": "unknown",
    "washer": "in_building"
  },
  "riskFlags": [
    "Date range is not explicit"
  ],
  "suggestedQuestions": [
    "Would a July 1 move-in through September 12 be acceptable?"
  ],
  "summary": "Short human-readable summary"
}
```

## Export And Restore

### CSV Export

CSV should support spreadsheet review. Include one row per active listing.

Fields:

- title
- source
- URL
- rent
- stay type
- bedroom label
- geography
- location confidence
- commute minutes
- transfers
- walk minutes
- bus-heavy flag
- PAMILA Score
- hard filter status
- status
- next action
- notes

### JSON Backup

JSON backup should contain full-fidelity local data:

- settings
- listings
- captures
- locations
- commute estimates
- score breakdowns
- status events
- AI analyses
- media metadata

Do not embed thumbnail binary data in JSON. Reference thumbnail metadata and local paths.

Restore should validate schema version before writing data.

## Testing Strategy

### Unit Tests

Test the shared `packages/core` logic:

- hard budget exclusion over $3,600
- private room fallback behavior
- default studio/1BR filter
- exact bedroom filters
- Leasebreak immediate move-in risk
- Leasebreak latest move-in/latest move-out eligibility
- Airbnb approximate location accepted without score penalty
- 35/20/15 scoring weights
- unknown fields create cleanup actions without score penalty
- duplicate URL canonicalization
- CSV and JSON export formatting

### API Tests

Test Fastify routes with an isolated SQLite test database:

- missing or invalid local token rejects `/api/*`
- capture import creates listing and raw capture
- duplicate capture updates existing listing instead of creating duplicate
- listing update recalculates score
- settings update recalculates affected scores
- AI analysis returns cached result for same input hash
- CSV export includes expected fields
- JSON backup and restore validate schema

### UI Tests

Use Playwright for dashboard behavior:

- Daily Queue shows highest-value actions first
- Inbox marks missing fields clearly
- Shortlist sorts by PAMILA Score
- Panic/Fallback Mode reveals private rooms
- Listing Detail shows score explanation and risk flags
- Map renders Ramp marker and listing pins
- Airbnb approximate-location listing shows confidence label
- Finalist status accepts Airbnb approximate pin with best available location

### Extension Tests

Use fixture HTML for Airbnb and Leasebreak pages:

- content script detects source
- capture payload includes URL/title/source/page text
- selected text is included when present
- thumbnail candidates are bounded
- extension sends token-protected request to local API
- extension does not crawl other pages

### Routing Tests

Default tests should mock OTP responses:

- simple subway route
- one-transfer route
- bus-heavy route
- long-walk route
- OTP unavailable fallback

Optional integration tests can run when local OTP data is installed.

## Implementation Milestones

### Milestone 1: Local Dashboard Foundation

- Create workspace structure.
- Build Fastify API, SQLite, Drizzle migrations.
- Implement settings, manual listings, statuses, notes, filters, scoring, and exports.
- Build React dashboard views: Daily Queue, Inbox, Shortlist, Listing Detail, Settings.

Acceptance:

- User can manually enter listings.
- Scores and hard filters work.
- CSV/JSON export works.
- No extension, AI, or OTP required.

### Milestone 2: Map And Manual Commute

- Add Map View with OSM tiles and attribution.
- Add Ramp marker and listing pins.
- Support manual location and commute fields.
- Generate external web directions links.

Acceptance:

- Listings can show on a map.
- Commute summaries affect scoring.
- Approximate Airbnb locations are labeled.

### Milestone 3: Chrome Capture Helper

- Build Chrome Manifest V3 extension.
- Capture Airbnb/Leasebreak listing URL, visible fields, page text, selected text, approximate location when available, and thumbnail candidates.
- POST to local token-protected API.

Acceptance:

- User can save a listing from Chrome into PAMILA.
- Captured listing appears in Inbox with cleanup actions.

### Milestone 4: Local Transit Routing

- Add Dockerized OTP setup under `ops/otp/`.
- Add scripts to download/cache NYC OSM extract and MTA GTFS feeds.
- Integrate API commute calculation with OTP.
- Store commute estimates and route summaries.

Acceptance:

- PAMILA can calculate subway/bus/walking commutes to Ramp.
- Route scoring uses total time, transfers, walking, and bus-heavy flag.

### Milestone 5: Optional AI Enrichment

- Add OpenAI Responses API integration.
- Run analysis on capture when enabled.
- Cache by input hash.
- Show suggested fields, risk flags, and host questions.

Acceptance:

- App works with AI disabled.
- With AI enabled, captured listings get advisory analysis.
- AI suggestions do not silently overwrite confirmed fields.

### Milestone 6: Polish And Reliability

- Improve duplicate detection.
- Add better status history.
- Add finalist comparison.
- Add backup restore.
- Harden error states for missing OTP, missing AI config, bad geocodes, and failed thumbnails.

## External References And Constraints

- OpenTripPlanner docs: [https://docs.opentripplanner.org/en/latest/](https://docs.opentripplanner.org/en/latest/)
- OpenTripPlanner container image docs: [https://docs.opentripplanner.org/en/v2.4.0/Container-Image/](https://docs.opentripplanner.org/en/v2.4.0/Container-Image/)
- MTA developer resources and GTFS feeds: [https://www.mta.info/developers](https://www.mta.info/developers)
- OSM tile usage policy: [https://operations.osmfoundation.org/policies/tiles/](https://operations.osmfoundation.org/policies/tiles/)
- Nominatim usage policy: [https://operations.osmfoundation.org/policies/nominatim/](https://operations.osmfoundation.org/policies/nominatim/)
- Airbnb API terms: [https://www.airbnb.com/terms/api](https://www.airbnb.com/terms/api)
- Leasebreak terms: [https://www.leasebreak.com/terms-and-conditions](https://www.leasebreak.com/terms-and-conditions)
- OpenAI Responses API reference: [https://platform.openai.com/docs/api-reference/responses](https://platform.openai.com/docs/api-reference/responses)

Constraints derived from these references:

- Use OTP locally with local transit and map data inputs instead of a paid maps API.
- Use MTA static GTFS feeds for NYC transit schedules.
- Use OSM tiles only for normal attributed interactive display.
- Use Nominatim only for light, cached, user-triggered geocoding.
- Avoid automated source-site crawling in v1.
- Keep OpenAI optional, cached, bounded, and advisory.

## Acceptance Criteria

The technical implementation is on track when:

- The app runs locally with `pnpm`.
- A user can enter or capture Airbnb/Leasebreak listings.
- Listings persist in SQLite.
- Hard filters are deterministic and explainable.
- PAMILA Score uses the documented 100-point rubric.
- Daily Queue gives concrete next actions.
- Map view shows listings and Ramp.
- Commute estimates can be manual first and OTP-backed later.
- Private rooms stay hidden until Panic/Fallback Mode.
- Airbnb approximate locations are supported without score penalty.
- CSV and JSON exports work.
- The app is useful with OpenAI disabled.

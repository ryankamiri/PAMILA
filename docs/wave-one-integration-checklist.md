# Wave One Integration Checklist

Use this after the four parallel workers finish. The goal is to connect their lanes into a first usable vertical slice without losing the ownership boundaries that made the parallel work possible.

## Worker Reports To Collect

- Core Logic: changed files, exported functions, tests, scoring assumptions, contract changes.
- Database/API: changed files, routes, schema shape, tests, dependencies, integration gaps.
- Dashboard UI: changed files, view/API client expectations, tests, mock-data assumptions.
- Chrome Extension: changed files, capture payload shape, settings behavior, tests, API expectations.

## First Vertical Slice

Target:

```text
manual listing in dashboard -> API stores in SQLite -> core scores it -> dashboard shows it
```

Checklist:

- Confirm shared listing/settings/score types align across Core, API, and Web.
- Confirm API can create a manual listing with the minimum fields the UI submits.
- Confirm API returns score breakdowns in the shape the UI expects.
- Confirm Daily Queue and Shortlist can render real API listings.
- Confirm Panic/Fallback Mode setting flows from UI to API to core scoring.
- Confirm unknown fields create cleanup actions instead of hidden score penalties.

## Second Vertical Slice

Target:

```text
extension capture -> API capture import -> listing appears in Inbox
```

Checklist:

- Confirm extension `POST /api/captures` payload matches API route expectations.
- Confirm API token/header expectations match extension settings.
- Confirm API deduplicates captures by canonical URL or payload hash.
- Confirm captured listings enter Inbox with cleanup actions.
- Confirm API unavailable errors are visible in extension UI.

## Verification

- Run `pnpm typecheck`.
- Run `pnpm test`.
- Run `pnpm build`.
- Smoke-test API health.
- Smoke-test web dev server startup.
- Smoke-test extension build output.

## Deferred Work

- Map/Commute and OpenTripPlanner remain wave two.
- Optional OpenAI analysis remains wave two.
- Media thumbnail persistence can remain stubbed unless already cleanly implemented.

# PAMILA OpenTripPlanner Setup

PAMILA uses a local OpenTripPlanner (OTP) service for subway, bus, and walking commute estimates to Ramp NYC. This setup is intentionally local and user-triggered: no script in this directory downloads large OpenStreetMap or GTFS files automatically during install, tests, or app startup.

## References

- OpenTripPlanner docs: <https://docs.opentripplanner.org/en/latest/>
- OTP container image docs: <https://docs.opentripplanner.org/en/v2.4.0/Container-Image/>
- MTA static GTFS feeds: <https://www.mta.info/developers>

The OTP container expects routing inputs and config under `/var/opentripplanner` inside the container. PAMILA mounts the local `data/otp/` directory there.

## Local Directory Layout

Create the local data directory from the repo root:

```sh
mkdir -p data/otp
```

Expected files:

```text
data/otp/
  osm.pbf
  mta-subway-gtfs.zip
  mta-bus-manhattan-gtfs.zip
  mta-bus-brooklyn-gtfs.zip
  mta-bus-queens-gtfs.zip
  build-config.json
  router-config.json
```

`data/` is ignored by git, so downloaded routing data and generated graphs stay local.

## Data Inputs

You can let PAMILA download the default v1 NYC inputs for you:

```sh
pnpm otp:download
```

This is intentionally user-triggered because the OpenStreetMap extract is large. The script skips files that already exist and copies the checked-in OTP config JSON files into `data/otp/`.

Clip the downloaded New York State extract to the NYC area before building:

```sh
pnpm otp:clip-osm
```

The clip step keeps the original state extract as `data/otp/new-york-state.osm.pbf.archive` and writes the smaller NYC routing extract to `data/otp/osm.pbf`. The archive suffix matters because OTP will try to read every `.pbf` input in the directory.

### OpenStreetMap

Use a NYC-area `.osm.pbf` extract and save it as:

```text
data/otp/osm.pbf
```

A small NYC/tri-state extract is preferable to a full planet or full-US extract because OTP graph builds can be memory intensive. If you use a Geofabrik region extract, clip it to the NYC area before building when possible.

### MTA Static GTFS

Use MTA static GTFS feeds from the MTA developer resources page.

Recommended v1 files for PAMILA:

- Subway regular GTFS, saved as `data/otp/mta-subway-gtfs.zip`
- Manhattan bus GTFS, saved as `data/otp/mta-bus-manhattan-gtfs.zip`
- Brooklyn bus GTFS, saved as `data/otp/mta-bus-brooklyn-gtfs.zip`
- Queens bus GTFS, saved as `data/otp/mta-bus-queens-gtfs.zip`

OTP needs `gtfs` in GTFS file names, so keep that word in every saved ZIP name.

## Config Files

Copy the checked-in starter configs into the local data directory:

```sh
cp ops/otp/config/build-config.json data/otp/build-config.json
cp ops/otp/config/router-config.json data/otp/router-config.json
```

The starter config is deliberately small. It is enough for local graph build experiments and can be tuned later after we see real route output.

## Build The Graph

After `data/otp/` contains `osm.pbf`, GTFS ZIP files, and config JSON:

```sh
pnpm otp:build
```

The script runs the OTP container with `--build --save`. It does not download data.

## Run OTP

Serve the saved graph locally:

```sh
pnpm otp:run
```

Default port:

```text
http://127.0.0.1:8080
```

The OTP GraphiQL UI should be available at:

```text
http://127.0.0.1:8080/graphiql
```

## Health Check

With OTP running:

```sh
pnpm otp:health
```

This checks the local OTP HTTP endpoint only. It does not prove the graph has every desired route, but it catches the common "server is not up" case.

## PAMILA Defaults

PAMILA's adapter defaults to:

- destination: Ramp NYC, 28 West 23rd Street
- arrival time: May 6, 2026 at 9:00 AM Eastern by default, used as a representative Wednesday commute because current MTA static feeds may not yet include the internship dates
- modes: walking access/egress plus subway/rail/bus transit
- endpoint: `http://127.0.0.1:8080/otp/gtfs/v1`

The API integration layer can override destination coordinates from settings once the office location is confirmed.

## Troubleshooting

- If graph build fails immediately, confirm the GTFS ZIP filenames include `gtfs`.
- If Docker runs out of memory, keep `pnpm otp:clip-osm` in the setup path and raise Docker Desktop's memory limit if needed. You can also override the Java heap, for example `JAVA_TOOL_OPTIONS=-Xmx4g pnpm otp:build`.
- If `/graphiql` works but PAMILA route requests fail, inspect the generated GraphQL query in the adapter test fixtures and compare it with OTP's live schema in GraphiQL.
- If OTP is unavailable, PAMILA should keep manual commute entry usable and scoreable.

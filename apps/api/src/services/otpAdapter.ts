import {
  DEFAULT_LOCAL_PORTS,
  RAMP_OFFICE,
  type CommuteRouteDetail,
  type CommuteRouteLeg,
  type CommuteRouteOption,
  type CommuteRouteLegStyle,
  type CommuteSummary,
  type LocationConfidence,
  type LocationSource
} from "@pamila/core";

export interface OtpCoordinate {
  lat: number;
  lon: number;
}

export interface OtpCommuteOrigin {
  label?: string;
  address?: string | null;
  crossStreets?: string | null;
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
  confidence?: LocationConfidence | "unknown";
  source?: LocationSource | "unknown";
  isUserConfirmed?: boolean;
}

export interface OtpRequestOptions {
  arrivalDateTime: string;
  destination: OtpCoordinate;
  destinationLabel: string;
  numItineraries: number;
  transitModes: string[];
}

export interface OtpClientOptions extends Partial<OtpRequestOptions> {
  endpoint?: string;
  fetcher?: FetchLike;
  timeoutMs?: number;
}

export interface OtpGraphqlRequest {
  operationName: "PamilaCommute";
  query: string;
}

export interface MappedOtpLeg {
  mode: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  fromName: string | null;
  geometry: Array<[number, number]>;
  toName: string | null;
  routeShortName: string | null;
  routeLongName: string | null;
  routeMode: string | null;
}

export interface MappedOtpItinerary {
  start: string | null;
  end: string | null;
  durationSeconds: number | null;
  legs: MappedOtpLeg[];
}

export interface MappedOtpRouteOption {
  id: string;
  label: string;
  itinerary: MappedOtpItinerary;
  summary: CommuteSummary;
  score: number;
  reasons: string[];
  selected: boolean;
}

export interface ManualCommuteInput {
  totalMinutes?: number | null;
  walkMinutes?: number | null;
  transferCount?: number | null;
  routeSummary?: string | null;
  lineNames?: string[];
  hasBusHeavyRoute?: boolean | null;
  calculatedAt?: string;
}

export interface ManualCommuteEstimate extends CommuteSummary {
  calculatedAt: string;
}

export type OtpCommuteEstimateResult =
  | {
      status: "ok";
      summary: CommuteSummary;
      itinerary: MappedOtpItinerary;
      request: OtpGraphqlRequest;
      routeDetail: CommuteRouteDetail;
      warnings: string[];
      externalDirectionsUrl: string | null;
    }
  | {
      status: "low_confidence_origin" | "otp_unavailable" | "otp_error" | "no_route";
      message: string;
      warnings: string[];
      externalDirectionsUrl: string | null;
      request?: OtpGraphqlRequest;
    };

type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

const DEFAULT_RAMP_COORDINATE: OtpCoordinate = {
  lat: 40.74205,
  lon: -73.99154
};

const DEFAULT_ARRIVAL_DATE_TIME = "2026-05-06T09:00:00-04:00";
const DEFAULT_TRANSIT_MODES = ["SUBWAY", "RAIL", "BUS"] as const;
const WALK_MODES = new Set(["WALK"]);
const BUS_MODES = new Set(["BUS", "COACH"]);
const TRANSIT_MODES = new Set([
  "AIRPLANE",
  "BUS",
  "CABLE_CAR",
  "COACH",
  "FERRY",
  "FUNICULAR",
  "GONDOLA",
  "RAIL",
  "SUBWAY",
  "TRAM"
]);

export const DEFAULT_OTP_ENDPOINT = `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.openTripPlanner}/otp/gtfs/v1`;

export const DEFAULT_OTP_REQUEST_OPTIONS: OtpRequestOptions = {
  arrivalDateTime: DEFAULT_ARRIVAL_DATE_TIME,
  destination: DEFAULT_RAMP_COORDINATE,
  destinationLabel: RAMP_OFFICE.name,
  numItineraries: 8,
  transitModes: [...DEFAULT_TRANSIT_MODES]
};

export function buildOtpGraphqlRequest(
  origin: OtpCoordinate,
  options: Partial<OtpRequestOptions> = {}
): OtpGraphqlRequest {
  const merged = mergeRequestOptions(options);
  const transitModes = merged.transitModes.map((mode) => `{ mode: ${mode} }`).join(", ");

  return {
    operationName: "PamilaCommute",
    query: `query PamilaCommute {
  planConnection(
    origin: { location: { coordinate: { latitude: ${formatCoordinate(origin.lat)}, longitude: ${formatCoordinate(origin.lon)} } } }
    destination: { location: { coordinate: { latitude: ${formatCoordinate(merged.destination.lat)}, longitude: ${formatCoordinate(merged.destination.lon)} } } }
    dateTime: { latestArrival: "${escapeGraphqlString(merged.arrivalDateTime)}" }
    modes: {
      direct: [WALK]
      transit: { transit: [${transitModes}] }
    }
    first: ${merged.numItineraries}
  ) {
    edges {
      node {
        start
        end
        duration
        legs {
          mode
          duration
          distance
          start { scheduledTime }
          end { scheduledTime }
          from { name }
          to { name }
          legGeometry { points }
          route {
            gtfsId
            longName
            shortName
            mode
          }
        }
      }
    }
  }
}`
  };
}

export async function requestOtpCommute(
  origin: OtpCommuteOrigin,
  options: OtpClientOptions = {}
): Promise<OtpCommuteEstimateResult> {
  const originValidation = validateOtpOrigin(origin);
  const externalDirectionsUrl = buildExternalDirectionsUrl(origin, options);

  if (!originValidation.ok) {
    return {
      externalDirectionsUrl,
      message: originValidation.message,
      status: "low_confidence_origin",
      warnings: originValidation.warnings
    };
  }

  const request = buildOtpGraphqlRequest(originValidation.coordinate, options);
  const endpoint = options.endpoint ?? DEFAULT_OTP_ENDPOINT;
  const fetcher = options.fetcher ?? globalThis.fetch;

  if (!fetcher) {
    return {
      externalDirectionsUrl,
      message: "No fetch implementation is available to call OpenTripPlanner.",
      request,
      status: "otp_unavailable",
      warnings: originValidation.warnings
    };
  }

  const timeoutMs = options.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(endpoint, {
      body: JSON.stringify(request),
      headers: {
        "content-type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        externalDirectionsUrl,
        message: `OpenTripPlanner returned HTTP ${response.status}.`,
        request,
        status: "otp_unavailable",
        warnings: originValidation.warnings
      };
    }

    const payload = await response.json();
    const mapped = mapOtpPlanResponse(payload);

    if (mapped.status !== "ok") {
      return {
        externalDirectionsUrl,
        message: mapped.message,
        request,
        status: mapped.status,
        warnings: [...originValidation.warnings, ...mapped.warnings]
      };
    }

    return {
      externalDirectionsUrl,
      itinerary: mapped.itinerary,
      request,
      routeDetail: buildRouteDetail(mapped.itinerary, {
        calculatedAt: new Date().toISOString(),
        destinationLabel: options.destinationLabel ?? DEFAULT_OTP_REQUEST_OPTIONS.destinationLabel,
        externalDirectionsUrl,
        originLabel: origin.label ?? origin.address ?? origin.crossStreets ?? origin.neighborhood ?? null,
        routeOptions: mapped.routeOptions
      }),
      status: "ok",
      summary: mapped.summary,
      warnings: [...originValidation.warnings, ...mapped.warnings]
    };
  } catch (error) {
    return {
      externalDirectionsUrl,
      message:
        error instanceof DOMException && error.name === "AbortError"
          ? `OpenTripPlanner did not respond within ${timeoutMs}ms.`
          : formatUnknownError(error),
      request,
      status: "otp_unavailable",
      warnings: originValidation.warnings
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function mapOtpPlanResponse(payload: unknown):
  | {
      status: "ok";
      summary: CommuteSummary;
      itinerary: MappedOtpItinerary;
      routeOptions: MappedOtpRouteOption[];
      warnings: string[];
    }
  | {
      status: "otp_error" | "no_route";
      message: string;
      warnings: string[];
    } {
  const errors = extractGraphqlErrors(payload);
  if (errors.length > 0) {
    return {
      message: `OpenTripPlanner GraphQL error: ${errors.join("; ")}`,
      status: "otp_error",
      warnings: []
    };
  }

  const itineraries = extractItineraries(payload);
  if (itineraries.length === 0) {
    return {
      message: "OpenTripPlanner returned no commute itineraries for this origin.",
      status: "no_route",
      warnings: []
    };
  }

  const routeOptions = rankItineraries(itineraries);
  const selectedOption = routeOptions[0] as MappedOtpRouteOption;
  const summary = selectedOption.summary;

  return {
    itinerary: selectedOption.itinerary,
    routeOptions,
    status: "ok",
    summary,
    warnings: routeSelectionWarnings(routeOptions)
  };
}

export function createManualCommuteEstimate(
  input: ManualCommuteInput,
  now: Date = new Date()
): ManualCommuteEstimate {
  return {
    calculatedAt: input.calculatedAt ?? now.toISOString(),
    confidence: "manual",
    hasBusHeavyRoute: input.hasBusHeavyRoute ?? false,
    lineNames: input.lineNames ?? [],
    routeSummary: input.routeSummary ?? null,
    totalMinutes: normalizeNullableInteger(input.totalMinutes),
    transferCount: normalizeNullableInteger(input.transferCount),
    walkMinutes: normalizeNullableInteger(input.walkMinutes)
  };
}

export function validateOtpOrigin(origin: OtpCommuteOrigin):
  | {
      ok: true;
      coordinate: OtpCoordinate;
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
      warnings: string[];
    } {
  const warnings: string[] = [];
  const coordinate = coordinateFromOrigin(origin);

  if (!coordinate) {
    return {
      message:
        "OpenTripPlanner needs latitude/longitude coordinates. Add or confirm the listing location before routing.",
      ok: false,
      warnings
    };
  }

  if (origin.confidence === "low" || origin.source === "airbnb_approx_pin") {
    warnings.push("Commute is based on an approximate or low-confidence origin.");
  }

  return {
    coordinate,
    ok: true,
    warnings
  };
}

export function buildExternalDirectionsUrl(
  origin: OtpCommuteOrigin,
  options: Partial<OtpRequestOptions> = {}
): string | null {
  const coordinate = coordinateFromOrigin(origin);
  if (!coordinate) {
    return null;
  }

  const merged = mergeRequestOptions(options);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${coordinate.lat},${coordinate.lon}`);
  url.searchParams.set("destination", `${merged.destination.lat},${merged.destination.lon}`);
  url.searchParams.set("travelmode", "transit");
  url.searchParams.set(
    "arrival_time",
    String(Math.floor(new Date(merged.arrivalDateTime).getTime() / 1000))
  );
  return url.toString();
}

function mergeRequestOptions(options: Partial<OtpRequestOptions>): OtpRequestOptions {
  return {
    arrivalDateTime: options.arrivalDateTime ?? DEFAULT_OTP_REQUEST_OPTIONS.arrivalDateTime,
    destination: options.destination ?? DEFAULT_OTP_REQUEST_OPTIONS.destination,
    destinationLabel: options.destinationLabel ?? DEFAULT_OTP_REQUEST_OPTIONS.destinationLabel,
    numItineraries: options.numItineraries ?? DEFAULT_OTP_REQUEST_OPTIONS.numItineraries,
    transitModes: options.transitModes ?? DEFAULT_OTP_REQUEST_OPTIONS.transitModes
  };
}

function coordinateFromOrigin(origin: OtpCommuteOrigin): OtpCoordinate | null {
  const lat = origin.lat;
  const lon = origin.lng;

  if (typeof lat !== "number" || typeof lon !== "number") {
    return null;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  return { lat, lon };
}

function extractGraphqlErrors(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return ["OTP response was not a JSON object."];
  }

  const errors = getArray(payload, "errors");
  return errors
    .map((error) => {
      if (isRecord(error)) {
        return getString(error, "message");
      }
      return null;
    })
    .filter((message): message is string => Boolean(message));
}

function extractItineraries(payload: unknown): MappedOtpItinerary[] {
  if (!isRecord(payload)) {
    return [];
  }

  const data = getRecord(payload, "data");
  const planConnection = data ? getRecord(data, "planConnection") : null;
  const edges = planConnection ? getArray(planConnection, "edges") : [];

  return edges
    .map((edge) => {
      const node = isRecord(edge) ? getRecord(edge, "node") : null;
      return node ? mapItinerary(node) : null;
    })
    .filter((itinerary): itinerary is MappedOtpItinerary => Boolean(itinerary));
}

function mapItinerary(node: Record<string, unknown>): MappedOtpItinerary {
  const legs = getArray(node, "legs")
    .map((leg) => (isRecord(leg) ? mapLeg(leg) : null))
    .filter((leg): leg is MappedOtpLeg => Boolean(leg));

  return {
    durationSeconds: getDurationSeconds(node),
    end: getString(node, "end"),
    legs,
    start: getString(node, "start")
  };
}

function mapLeg(leg: Record<string, unknown>): MappedOtpLeg {
  const route = getRecord(leg, "route");
  const from = getRecord(leg, "from");
  const legGeometry = getRecord(leg, "legGeometry");
  const to = getRecord(leg, "to");
  const mode = getString(leg, "mode") ?? getString(route, "mode") ?? "UNKNOWN";
  const encodedGeometry = getString(legGeometry, "points");

  return {
    distanceMeters: getNumber(leg, "distance"),
    durationSeconds: getDurationSeconds(leg),
    fromName: getString(from, "name"),
    geometry: encodedGeometry ? decodeEncodedPolyline(encodedGeometry) : [],
    mode,
    routeLongName: getString(route, "longName"),
    routeMode: getString(route, "mode"),
    routeShortName: getString(route, "shortName"),
    toName: getString(to, "name")
  };
}

function chooseBestItinerary(itineraries: MappedOtpItinerary[]): MappedOtpItinerary {
  return (rankItineraries(itineraries)[0] as MappedOtpRouteOption).itinerary;
}

function rankItineraries(itineraries: MappedOtpItinerary[]): MappedOtpRouteOption[] {
  const scored = itineraries.map((itinerary, index) => {
    const summary = summarizeItinerary(itinerary);
    const score = scoreItinerary(itinerary, summary);

    return {
      id: `route-${index + 1}`,
      itinerary,
      label: routeOptionLabel(summary, index),
      reasons: routeOptionReasons(itinerary, summary, score),
      score,
      selected: false,
      summary
    };
  });
  const deduped = dedupeRouteOptions(scored);

  deduped.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }

    const leftDuration = totalSeconds(left.itinerary) ?? Number.POSITIVE_INFINITY;
    const rightDuration = totalSeconds(right.itinerary) ?? Number.POSITIVE_INFINITY;
    if (leftDuration !== rightDuration) {
      return leftDuration - rightDuration;
    }

    const leftTransfers = transferCount(left.itinerary);
    const rightTransfers = transferCount(right.itinerary);
    if (leftTransfers !== rightTransfers) {
      return leftTransfers - rightTransfers;
    }

    return (walkSeconds(left.itinerary) ?? 0) - (walkSeconds(right.itinerary) ?? 0);
  });

  return deduped.map((option, index) => ({
    ...option,
    label: index === 0 ? "Best PAMILA route" : `Alternative ${index + 1}`,
    selected: index === 0
  }));
}

function dedupeRouteOptions(routeOptions: MappedOtpRouteOption[]): MappedOtpRouteOption[] {
  const seen = new Set<string>();
  const deduped: MappedOtpRouteOption[] = [];

  for (const option of routeOptions) {
    const key = routeOptionDedupeKey(option);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(option);
  }

  return deduped;
}

function routeOptionDedupeKey(option: MappedOtpRouteOption): string {
  const legKey = option.itinerary.legs
    .map((leg) => `${normalizeMode(leg.routeMode ?? leg.mode)}:${leg.routeShortName ?? leg.routeLongName ?? ""}`)
    .join("|");

  return [
    option.summary.routeSummary ?? "route",
    option.summary.totalMinutes ?? "?",
    option.summary.walkMinutes ?? "?",
    option.summary.transferCount ?? "?",
    option.summary.hasBusHeavyRoute ? "bus-heavy" : "not-bus-heavy",
    legKey
  ].join("::");
}

function scoreItinerary(itinerary: MappedOtpItinerary, summary: CommuteSummary): number {
  let score = 100;
  const totalMinutes = summary.totalMinutes;
  const walkMinutes = summary.walkMinutes ?? 0;
  const transfers = summary.transferCount ?? transferCount(itinerary);
  const busLegCount = itinerary.legs.filter(isBusLeg).length;
  const transitLegs = itinerary.legs.filter(isTransitLeg);
  const hasRailLikeLeg = transitLegs.some(isRailLikeLeg);

  if (totalMinutes === null) {
    score -= 25;
  } else {
    score -= Math.max(0, totalMinutes - 20) * 1.2;
    score -= Math.max(0, totalMinutes - 35) * 2.5;
  }

  score -= transfers * 5;
  score -= Math.max(0, walkMinutes - 10) * 2;
  score -= Math.max(0, walkMinutes - 15) * 3;

  if (summary.hasBusHeavyRoute) {
    score -= 35;
  }
  if (busLegCount > 0) {
    score -= 15 + busLegCount * 4;
  }
  if (transitLegs.length === 0 && (totalMinutes ?? 0) > 15) {
    score -= 20;
  }
  if (hasRailLikeLeg) {
    score += 8;
  }
  if (transfers === 0) {
    score += 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function routeOptionLabel(summary: CommuteSummary, index: number): string {
  if (summary.lineNames.length > 0) {
    return summary.lineNames.join(" -> ");
  }

  return index === 0 ? "Route option" : `Route option ${index + 1}`;
}

function routeOptionReasons(
  itinerary: MappedOtpItinerary,
  summary: CommuteSummary,
  score: number
): string[] {
  const reasons: string[] = [];
  const hasBus = itinerary.legs.some(isBusLeg);

  if (!hasBus) {
    reasons.push("No bus legs");
  } else if (summary.hasBusHeavyRoute) {
    reasons.push("Bus-heavy penalty");
  } else {
    reasons.push("Contains bus leg");
  }

  if (itinerary.legs.some(isRailLikeLeg)) {
    reasons.push("Uses subway/rail");
  }

  if ((summary.transferCount ?? 0) === 0) {
    reasons.push("No transfers");
  }

  if ((summary.walkMinutes ?? 0) > 15) {
    reasons.push("Long walk penalty");
  } else if ((summary.walkMinutes ?? 0) <= 10) {
    reasons.push("Short walk");
  }

  reasons.push(`Route score ${score}/100`);
  return reasons;
}

function routeSelectionWarnings(routeOptions: MappedOtpRouteOption[]): string[] {
  const selected = routeOptions.find((option) => option.selected);
  if (!selected) {
    return [];
  }

  const fastest = [...routeOptions].sort((left, right) => {
    const leftDuration = left.summary.totalMinutes ?? Number.POSITIVE_INFINITY;
    const rightDuration = right.summary.totalMinutes ?? Number.POSITIVE_INFINITY;
    return leftDuration - rightDuration;
  })[0];

  if (!fastest || fastest.id === selected.id) {
    return [];
  }

  if (fastest.summary.hasBusHeavyRoute && !selected.summary.hasBusHeavyRoute) {
    return [
      `Selected a ${formatNullableMinutes(selected.summary.totalMinutes)} non-bus-heavy route over a ${formatNullableMinutes(
        fastest.summary.totalMinutes
      )} bus-heavy route.`
    ];
  }

  return [
    "Selected the highest-scoring route, which may be longer than the fastest OTP option."
  ];
}

function summarizeItinerary(itinerary: MappedOtpItinerary): CommuteSummary {
  const lineNames = extractLineNames(itinerary);

  return {
    confidence: "estimated",
    hasBusHeavyRoute: isBusHeavyRoute(itinerary),
    lineNames,
    routeSummary: buildRouteSummary(itinerary, lineNames),
    totalMinutes: secondsToMinutes(totalSeconds(itinerary)),
    transferCount: transferCount(itinerary),
    walkMinutes: secondsToMinutes(walkSeconds(itinerary))
  };
}

function buildRouteDetail(
  itinerary: MappedOtpItinerary,
  options: {
    calculatedAt: string;
    destinationLabel: string;
    externalDirectionsUrl: string | null;
    originLabel: string | null;
    routeOptions?: MappedOtpRouteOption[];
  }
): CommuteRouteDetail {
  const selectedOption = options.routeOptions?.find((option) => option.selected);
  const routeDetail: CommuteRouteDetail = {
    calculatedAt: options.calculatedAt,
    destinationLabel: options.destinationLabel,
    externalDirectionsUrl: options.externalDirectionsUrl,
    legs: itinerary.legs.map(mapRouteDetailLeg),
    originLabel: options.originLabel
  };

  if (options.routeOptions) {
    routeDetail.alternatives = options.routeOptions.map((option) => buildCommuteRouteOption(option));
  }

  if (selectedOption) {
    routeDetail.selectionReasons = selectedOption.reasons;
    routeDetail.selectionScore = selectedOption.score;
  }

  return routeDetail;
}

function buildCommuteRouteOption(option: MappedOtpRouteOption): CommuteRouteOption {
  return {
    id: option.id,
    label: option.label,
    legs: option.itinerary.legs.map(mapRouteDetailLeg),
    reasons: option.reasons,
    score: option.score,
    selected: option.selected,
    summary: option.summary
  };
}

function mapRouteDetailLeg(leg: MappedOtpLeg): CommuteRouteLeg {
  const display = routeLegDisplay(leg);

  return {
    color: display.color,
    dashArray: display.dashArray,
    distanceMeters: leg.distanceMeters,
    durationMinutes: secondsToMinutes(leg.durationSeconds),
    fromName: leg.fromName,
    geometry: leg.geometry,
    lineName: leg.routeShortName ?? null,
    mode: normalizeMode(leg.mode),
    routeLongName: leg.routeLongName,
    style: display.style,
    toName: leg.toName
  };
}

function routeLegDisplay(leg: MappedOtpLeg): {
  color: string;
  dashArray: string | null;
  style: CommuteRouteLegStyle;
} {
  const mode = normalizeMode(leg.routeMode ?? leg.mode);

  if (WALK_MODES.has(mode)) {
    return {
      color: "#6b7280",
      dashArray: "6 6",
      style: "walk"
    };
  }

  if (BUS_MODES.has(mode) || isBusLeg(leg)) {
    return {
      color: "#b45309",
      dashArray: null,
      style: "bus"
    };
  }

  if (mode === "FERRY") {
    return {
      color: "#0f766e",
      dashArray: null,
      style: "ferry"
    };
  }

  if (mode === "RAIL" || mode === "SUBWAY" || mode === "TRAM") {
    return {
      color: "#2563eb",
      dashArray: null,
      style: "rail"
    };
  }

  return {
    color: "#2e7d6b",
    dashArray: null,
    style: "other"
  };
}

function extractLineNames(itinerary: MappedOtpItinerary): string[] {
  const names = itinerary.legs
    .filter(isTransitLeg)
    .map((leg) => leg.routeShortName ?? leg.routeLongName ?? normalizeMode(leg.mode))
    .filter((name) => name !== "UNKNOWN");

  return [...new Set(names)];
}

function buildRouteSummary(itinerary: MappedOtpItinerary, lineNames: string[]): string {
  if (lineNames.length === 0) {
    return itinerary.legs.some((leg) => isWalkMode(leg.mode)) ? "Walk only" : "Route found";
  }

  return lineNames.join(" -> ");
}

function transferCount(itinerary: MappedOtpItinerary): number {
  const transitLegs = itinerary.legs.filter(isTransitLeg);
  return Math.max(transitLegs.length - 1, 0);
}

function walkSeconds(itinerary: MappedOtpItinerary): number | null {
  return sumDurations(itinerary.legs.filter((leg) => isWalkMode(leg.mode)));
}

function totalSeconds(itinerary: MappedOtpItinerary): number | null {
  return itinerary.durationSeconds ?? sumDurations(itinerary.legs);
}

function sumDurations(legs: MappedOtpLeg[]): number | null {
  const knownDurations = legs
    .map((leg) => leg.durationSeconds)
    .filter((duration): duration is number => typeof duration === "number");

  if (knownDurations.length === 0) {
    return null;
  }

  return knownDurations.reduce((sum, duration) => sum + duration, 0);
}

function isBusHeavyRoute(itinerary: MappedOtpItinerary): boolean {
  const transitLegs = itinerary.legs.filter(isTransitLeg);
  const busLegs = transitLegs.filter(isBusLeg);

  if (busLegs.length === 0) {
    return false;
  }

  const transitSeconds = sumDurations(transitLegs);
  const busSeconds = sumDurations(busLegs);

  if (typeof transitSeconds === "number" && typeof busSeconds === "number") {
    const longestTransitLeg = Math.max(
      ...transitLegs.map((leg) => leg.durationSeconds ?? 0)
    );
    const longestBusLeg = Math.max(...busLegs.map((leg) => leg.durationSeconds ?? 0));

    return busSeconds >= transitSeconds / 2 || longestBusLeg >= longestTransitLeg;
  }

  return busLegs.length >= Math.ceil(transitLegs.length / 2);
}

function isTransitLeg(leg: MappedOtpLeg): boolean {
  const mode = normalizeMode(leg.routeMode ?? leg.mode);
  return TRANSIT_MODES.has(mode) || Boolean(leg.routeShortName || leg.routeLongName);
}

function isBusLeg(leg: MappedOtpLeg): boolean {
  const mode = normalizeMode(leg.routeMode ?? leg.mode);
  const line = leg.routeShortName ?? leg.routeLongName ?? "";
  return BUS_MODES.has(mode) || /^(B|BX|M|Q|S)\d/i.test(line);
}

function isRailLikeLeg(leg: MappedOtpLeg): boolean {
  const mode = normalizeMode(leg.routeMode ?? leg.mode);
  return mode === "RAIL" || mode === "SUBWAY" || mode === "TRAM";
}

function isWalkMode(mode: string): boolean {
  return WALK_MODES.has(normalizeMode(mode));
}

function normalizeMode(mode: string): string {
  return mode.trim().toUpperCase();
}

function formatNullableMinutes(minutes: number | null): string {
  return minutes === null ? "unknown-time" : `${minutes}-minute`;
}

function getDurationSeconds(record: Record<string, unknown>): number | null {
  const duration = record.duration;

  if (typeof duration === "number" && Number.isFinite(duration)) {
    return duration;
  }

  if (typeof duration === "string") {
    const parsed = parseDurationString(duration);
    if (parsed !== null) {
      return parsed;
    }
  }

  const start = getDateTimeString(record, "start");
  const end = getDateTimeString(record, "end");
  if (start && end) {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      return Math.round((endMs - startMs) / 1000);
    }
  }

  return null;
}

function getDateTimeString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];

  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value)) {
    return getString(value, "scheduledTime");
  }

  return null;
}

function parseDurationString(duration: string): number | null {
  const numeric = Number(duration);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(duration);
  if (!iso) {
    return null;
  }

  const hours = Number(iso[1] ?? 0);
  const minutes = Number(iso[2] ?? 0);
  const seconds = Number(iso[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function secondsToMinutes(seconds: number | null): number | null {
  if (seconds === null) {
    return null;
  }

  return Math.ceil(seconds / 60);
}

function normalizeNullableInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.round(value));
}

export function decodeEncodedPolyline(encoded: string): Array<[number, number]> {
  const coordinates: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  try {
    while (index < encoded.length) {
      const latResult = decodePolylineValue(encoded, index);
      index = latResult.nextIndex;
      lat += latResult.delta;

      const lngResult = decodePolylineValue(encoded, index);
      index = lngResult.nextIndex;
      lng += lngResult.delta;

      const point: [number, number] = [lat / 1e5, lng / 1e5];
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        return [];
      }
      coordinates.push(point);
    }
  } catch {
    return [];
  }

  return coordinates;
}

function decodePolylineValue(
  encoded: string,
  startIndex: number
): {
  delta: number;
  nextIndex: number;
} {
  let index = startIndex;
  let result = 0;
  let shift = 0;
  let byte = 0;

  do {
    if (index >= encoded.length) {
      throw new Error("Malformed encoded polyline.");
    }

    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    delta: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index
  };
}

function getRecord(
  value: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function getArray(value: Record<string, unknown>, key: string): unknown[] {
  const array = value[key];
  return Array.isArray(array) ? array : [];
}

function getString(value: Record<string, unknown> | null, key: string): string | null {
  if (!value) {
    return null;
  }

  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function getNumber(value: Record<string, unknown>, key: string): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCoordinate(coordinate: number): string {
  return coordinate.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeGraphqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "OpenTripPlanner request failed.";
}

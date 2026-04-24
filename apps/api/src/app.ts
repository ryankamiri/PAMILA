import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  connectPamilaDb,
  type BackupPayload,
  type CaptureImportInput,
  type CaptureRecord,
  type CreateListingInput,
  type ListListingsOptions,
  type ListingRecord,
  type ListingWithScore,
  type PamilaDatabase,
  type SettingsRecord,
  type UpsertCommuteEstimateInput,
  type UpsertLocationInput,
  type UpdateListingInput
} from "@pamila/db";
import {
  BEDROOM_FILTERS,
  LISTING_SOURCES,
  LISTING_STATUSES,
  STAY_TYPES,
  type BedroomFilter,
  type CommuteRouteDetail,
  type CommuteSummary,
  type ListingLocation,
  type ListingSource,
  type ListingStatus,
  type StayType
} from "@pamila/core";

import {
  analyzeCaptureWithOpenAI,
  buildCaptureCleanupSuggestions,
  type CaptureCleanupSuggestions
} from "./captureAnalysis.js";
import { loadApiConfig } from "./config.js";
import { calculateListingScore } from "./scoring.js";
import { requestOtpCommute } from "./services/otpAdapter.js";

export interface BuildAppOptions {
  db?: PamilaDatabase;
  databaseUrl?: string;
  fetchImpl?: typeof fetch;
  geocoderUrl?: string;
  openAiApiKey?: string | null;
  openAiModel?: string;
  otpUrl?: string;
  token?: string;
}

export function buildApp(options: BuildAppOptions = {}) {
  const config = loadApiConfig();
  const db = options.db ?? connectPamilaDb({ databaseUrl: options.databaseUrl ?? config.databaseUrl });
  const localToken = options.token ?? config.localToken;
  const openAiApiKey = "openAiApiKey" in options ? options.openAiApiKey : config.openAiApiKey;
  const openAiModel = options.openAiModel ?? config.openAiModel;
  const geocoderUrl = options.geocoderUrl ?? config.geocoderUrl;
  const otpUrl = options.otpUrl ?? config.otpUrl;
  const ownsDb = !options.db;

  const app = Fastify({
    logger: false
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", corsOriginForRequest(request.headers.origin, config.webOrigin));
    reply.header("Access-Control-Allow-Headers", "Content-Type, X-PAMILA-Token");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }

    if (!request.url.startsWith("/api/")) {
      return;
    }

    const token = request.headers["x-pamila-token"];
    if (token !== localToken) {
      await reply.code(401).send({
        error: "unauthorized",
        message: "Missing or invalid X-PAMILA-Token header."
      });
    }
  });

  app.addHook("onClose", async () => {
    if (ownsDb) {
      db.close();
    }
  });

  app.get("/health", async () => ({
    service: "pamila-api",
    status: "ok"
  }));

  app.get("/api/settings", async () => ({
    settings: db.getSettings()
  }));

  app.put("/api/settings", async (request, reply) => {
    const body = asObject(request.body);
    const input = coerceSettingsUpdate(body);
    const settings = db.updateSettings(input);
    return reply.send({ settings });
  });

  app.get("/api/listings", async (request) => {
    const query = asObject(request.query);
    const options: ListListingsOptions = {};
    if (isListingSource(query.source)) {
      options.source = query.source;
    }
    if (isListingStatus(query.status)) {
      options.status = query.status;
    }

    return {
      listings: db.listListings(options).map((listing) => listingForResponse(db, listing))
    };
  });

  app.post("/api/listings", async (request, reply) => {
    const input = coerceCreateListing(asObject(request.body));
    if (!input.ok) {
      return badRequest(reply, input.message);
    }

    const listing = db.createListing(input.value);
    const scored = recalculateListing(db, listing.id);
    return reply.code(201).send({ listing: scored });
  });

  app.get("/api/listings/:id", async (request, reply) => {
    const id = getRouteId(request.params);
    const listing = db.getListing(id);
    if (!listing) {
      return notFound(reply, "Listing not found.");
    }
    return { listing: listingForResponse(db, listing) };
  });

  app.get("/api/listings/:id/location", async (request, reply) => {
    const id = getRouteId(request.params);
    if (!db.getListing(id)) {
      return notFound(reply, "Listing not found.");
    }

    return {
      location: db.getCurrentLocation(id)
    };
  });

  app.put("/api/listings/:id/location", async (request, reply) => {
    const id = getRouteId(request.params);
    const input = coerceLocationUpdate(asObject(request.body));
    const location = db.upsertListingLocation(id, input);
    if (!location) {
      return notFound(reply, "Listing not found.");
    }

    const listing = recalculateListing(db, id);
    return reply.send({ listing, location });
  });

  app.post("/api/listings/:id/location/geocode", async (request, reply) => {
    const id = getRouteId(request.params);
    const listing = db.getListing(id);
    if (!listing) {
      return notFound(reply, "Listing not found.");
    }

    const location = db.getCurrentLocation(id);
    if (!location) {
      return reply.send({
        location: null,
        listing: listingForResponse(db, listing),
        status: "missing_query",
        warnings: ["Add an address, cross streets, or neighborhood before geocoding."]
      } satisfies GeocodeListingResponse);
    }

    const geocoded = await geocodeListingLocation(location, {
      fetchImpl: options.fetchImpl,
      geocoderUrl
    });

    if (geocoded.status !== "ok") {
      return reply.send({
        location,
        listing: listingForResponse(db, listing),
        status: geocoded.status,
        warnings: geocoded.warnings
      } satisfies GeocodeListingResponse);
    }

    const updatedLocation = db.upsertListingLocation(id, {
      address: location.address,
      confidence: location.confidence === "low" ? "medium" : location.confidence,
      crossStreets: location.crossStreets,
      geographyCategory: location.geographyCategory,
      isUserConfirmed: location.isUserConfirmed,
      label: location.label,
      lat: geocoded.lat,
      lng: geocoded.lng,
      neighborhood: location.neighborhood,
      source: location.source
    });
    const refreshedListing = recalculateListing(db, id);

    return reply.send({
      location: updatedLocation,
      listing: refreshedListing,
      status: "ok",
      warnings: geocoded.warnings
    } satisfies GeocodeListingResponse);
  });

  app.get("/api/listings/:id/commute", async (request, reply) => {
    const id = getRouteId(request.params);
    if (!db.getListing(id)) {
      return notFound(reply, "Listing not found.");
    }

    return {
      commute: db.getCurrentCommuteEstimate(id),
      routeDetail: db.getCurrentCommuteEstimate(id)?.routeDetail ?? null
    };
  });

  const updateCommuteHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const id = getRouteId(request.params);
    const input = coerceCommuteUpdate(asObject(request.body));
    const commute = db.upsertManualCommuteEstimate(id, input);
    if (!commute) {
      return notFound(reply, "Listing not found.");
    }

    const listing = recalculateListing(db, id);
    return reply.send({ commute, listing });
  };

  app.put("/api/listings/:id/commute", updateCommuteHandler);
  app.put("/api/listings/:id/commute/manual", updateCommuteHandler);

  app.post("/api/listings/:id/commute/calculate", async (request, reply) => {
    const id = getRouteId(request.params);
    const listing = db.getListing(id);
    if (!listing) {
      return notFound(reply, "Listing not found.");
    }

    const location = db.getCurrentLocation(id);
    const existingCommute = db.getCurrentCommuteEstimate(id);
    if (!hasCoordinates(location)) {
      return reply.send({
        commute: existingCommute,
        externalDirectionsUrl: null,
        listing: listingForResponse(db, listing),
        routeDetail: null,
        status: "missing_location",
        warnings: ["Add coordinates with geocoding or manual latitude/longitude before OTP routing."]
      } satisfies CalculateCommuteResponse);
    }

    const settings = db.getSettings();
    const officeDestination =
      settings.officeLat !== null && settings.officeLng !== null
        ? { lat: settings.officeLat, lon: settings.officeLng }
        : null;
    const otpResult = await requestOtpCommute(location, {
      endpoint: otpUrl,
      ...(options.fetchImpl ? { fetcher: options.fetchImpl } : {}),
      ...(officeDestination ? { destination: officeDestination } : {})
    });

    if (otpResult.status !== "ok") {
      return reply.send({
        commute: existingCommute,
        externalDirectionsUrl: otpResult.externalDirectionsUrl,
        listing: listingForResponse(db, listing),
        routeDetail: null,
        status: otpResult.status === "low_confidence_origin" ? "missing_location" : otpResult.status,
        warnings: [otpResult.message, ...otpResult.warnings]
      } satisfies CalculateCommuteResponse);
    }

    const calculatedAt = new Date().toISOString();
    const routeDetail = {
      ...otpResult.routeDetail,
      calculatedAt
    };
    const commute = db.upsertManualCommuteEstimate(id, {
      ...otpResult.summary,
      calculatedAt,
      confidence: "estimated",
      routeDetail
    });
    const refreshedListing = recalculateListing(db, id);
    const savedRouteDetail = commute?.routeDetail ?? routeDetail;

    return reply.send({
      commute,
      externalDirectionsUrl: otpResult.externalDirectionsUrl,
      listing: refreshedListing
        ? {
            ...refreshedListing,
            commute,
            commuteEstimate: commute,
            lastCommuteCheckedAt: commute?.calculatedAt ?? null,
            routeDetail: savedRouteDetail
          }
        : null,
      routeDetail: savedRouteDetail,
      status: "ok",
      warnings: otpResult.warnings
    } satisfies CalculateCommuteResponse);
  });

  app.post("/api/listings/:id/commute/prepare", async (request, reply) => {
    const id = getRouteId(request.params);
    const listing = db.getListing(id);
    if (!listing) {
      return notFound(reply, "Listing not found.");
    }

    const warnings: string[] = [];
    let location: ListingLocation | null = db.getCurrentLocation(id);
    const existingCommute = db.getCurrentCommuteEstimate(id);

    if (!location) {
      location = applyBestApproximateLocationFromCaptures(db, listing);
    }

    if (!location) {
      return reply.send({
        commute: existingCommute,
        listing: listingForResponse(db, listing),
        location: null,
        nextStep: "add_location",
        routeDetail: existingCommute?.routeDetail ?? null,
        status: "missing_location",
        warnings: ["No location text was captured yet."]
      } satisfies PrepareCommuteResponse);
    }

    if (!hasCoordinates(location)) {
      const geocoded = await geocodeListingLocation(location, {
        fetchImpl: options.fetchImpl,
        geocoderUrl
      });

      if (geocoded.status !== "ok") {
        return reply.send({
          commute: existingCommute,
          listing: listingForResponse(db, listing),
          location,
          nextStep: nextStepForGeocodeStatus(geocoded.status),
          routeDetail: existingCommute?.routeDetail ?? null,
          status: geocoded.status === "missing_query" ? "missing_location" : geocoded.status,
          warnings: prepareGeocodeWarnings(geocoded.status, geocoded.warnings)
        } satisfies PrepareCommuteResponse);
      }

      const updatedLocation = db.upsertListingLocation(id, {
        address: location.address,
        confidence: location.confidence === "low" ? "medium" : location.confidence,
        crossStreets: location.crossStreets,
        geographyCategory: location.geographyCategory,
        isUserConfirmed: location.isUserConfirmed,
        label: location.label,
        lat: geocoded.lat,
        lng: geocoded.lng,
        neighborhood: location.neighborhood,
        source: location.source
      });
      location = updatedLocation ?? location;
    }

    if (!hasCoordinates(location)) {
      return reply.send({
        commute: existingCommute,
        listing: listingForResponse(db, listing),
        location,
        nextStep: "enter_coordinates",
        routeDetail: existingCommute?.routeDetail ?? null,
        status: "missing_location",
        warnings: ["Could not find coordinates for this location; enter lat/lng manually."]
      } satisfies PrepareCommuteResponse);
    }

    if (isApproximateLocation(location)) {
      warnings.push("Route uses approximate location; confirm exact address before final decision.");
    }

    const settings = db.getSettings();
    const officeDestination =
      settings.officeLat !== null && settings.officeLng !== null
        ? { lat: settings.officeLat, lon: settings.officeLng }
        : null;
    const otpResult = await requestOtpCommute(location, {
      endpoint: otpUrl,
      ...(options.fetchImpl ? { fetcher: options.fetchImpl } : {}),
      ...(officeDestination ? { destination: officeDestination } : {})
    });

    if (otpResult.status !== "ok") {
      const status = otpResult.status === "low_confidence_origin" ? "missing_location" : otpResult.status;
      return reply.send({
        commute: existingCommute,
        externalDirectionsUrl: otpResult.externalDirectionsUrl,
        listing: listingForResponse(db, listing),
        location,
        nextStep: nextStepForOtpStatus(status),
        routeDetail: existingCommute?.routeDetail ?? null,
        status,
        warnings: uniqueStrings([...warnings, prepareOtpWarning(status, otpResult.message), ...otpResult.warnings])
      } satisfies PrepareCommuteResponse);
    }

    const calculatedAt = new Date().toISOString();
    const routeDetail = {
      ...otpResult.routeDetail,
      calculatedAt
    };
    if (!routeDetail.legs.some((leg) => leg.geometry.length > 1)) {
      warnings.push("Route steps saved, but no drawable line came back.");
    }

    const commute = db.upsertManualCommuteEstimate(id, {
      ...otpResult.summary,
      calculatedAt,
      confidence: "estimated",
      routeDetail
    });
    const refreshedListing = recalculateListing(db, id);
    const savedRouteDetail = commute?.routeDetail ?? routeDetail;

    return reply.send({
      commute,
      externalDirectionsUrl: otpResult.externalDirectionsUrl,
      listing: refreshedListing
        ? {
            ...refreshedListing,
            commute,
            commuteEstimate: commute,
            lastCommuteCheckedAt: commute?.calculatedAt ?? null,
            location,
            routeDetail: savedRouteDetail
          }
        : null,
      location,
      nextStep: "review_route",
      routeDetail: savedRouteDetail,
      status: "ok",
      warnings: uniqueStrings([...warnings, ...otpResult.warnings])
    } satisfies PrepareCommuteResponse);
  });

  app.get("/api/listings/:id/captures", async (request, reply) => {
    const id = getRouteId(request.params);
    if (!db.getListing(id)) {
      return notFound(reply, "Listing not found.");
    }

    return {
      captures: db.listCapturesByListing(id)
    };
  });

  app.patch("/api/listings/:id", async (request, reply) => {
    const id = getRouteId(request.params);
    const input = coerceUpdateListing(asObject(request.body));
    const listing = db.updateListing(id, input);
    if (!listing) {
      return notFound(reply, "Listing not found.");
    }

    const scored = recalculateListing(db, id);
    return reply.send({ listing: scored });
  });

  app.delete("/api/listings/:id", async (request, reply) => {
    const id = getRouteId(request.params);
    const deleted = db.deleteListing(id);
    if (!deleted) {
      return notFound(reply, "Listing not found.");
    }
    return reply.code(204).send();
  });

  app.get("/api/captures", async () => ({
    captures: db.listCaptures()
  }));

  app.get("/api/captures/:id", async (request, reply) => {
    const id = getRouteId(request.params);
    const capture = db.getCapture(id);
    if (!capture) {
      return notFound(reply, "Capture not found.");
    }

    return { capture };
  });

  app.get("/api/captures/:id/cleanup-suggestions", async (request, reply) => {
    const id = getRouteId(request.params);
    const capture = db.getCapture(id);
    if (!capture) {
      return notFound(reply, "Capture not found.");
    }

    return {
      suggestions: buildCaptureCleanupSuggestions(capture)
    };
  });

  app.post("/api/captures/:id/analyze", async (request, reply) => {
    const id = getRouteId(request.params);
    const capture = db.getCapture(id);
    if (!capture) {
      return notFound(reply, "Capture not found.");
    }

    try {
      return await analyzeCaptureForResponse(db, capture, {
        fetchImpl: options.fetchImpl,
        openAiApiKey,
        openAiModel
      });
    } catch (error) {
      return reply.code(502).send({
        error: "openai_analysis_failed",
        message: error instanceof Error ? error.message : "OpenAI analysis failed."
      });
    }
  });

  app.post("/api/captures", async (request, reply) => {
    const input = coerceCaptureImport(asObject(request.body));
    if (!input.ok) {
      return badRequest(reply, input.message);
    }

    const imported = db.importCapture(input.value);
    const suggestions = buildCaptureCleanupSuggestions(imported.capture);
    applyCaptureSuggestions(db, imported.listing, suggestions, input.value.approxLocation);
    const listing = recalculateListing(db, imported.listing.id);
    const analysis = await maybeAnalyzeCaptureOnImport(db, imported.capture, {
      fetchImpl: options.fetchImpl,
      openAiApiKey,
      openAiModel
    });

    return reply.code(201).send({
      analysis,
      capture: imported.capture,
      listing,
      suggestions
    });
  });

  app.post("/api/listings/:id/recalculate-score", async (request, reply) => {
    const id = getRouteId(request.params);
    const listing = recalculateListing(db, id);
    if (!listing) {
      return notFound(reply, "Listing not found.");
    }
    return { listing, scoreBreakdown: listing.scoreBreakdown };
  });

  app.post("/api/scores/recalculate", async () => {
    const listings = db
      .listListings()
      .flatMap((listing) => {
        const recalculated = recalculateListing(db, listing.id);
        return recalculated ? [recalculated] : [];
      });

    return {
      listings,
      recalculatedCount: listings.length
    };
  });

  app.get("/api/exports/listings.csv", async (_request, reply) => {
    const listings = db.listListings();
    db.recordExport("csv", listings.length);
    return reply.type("text/csv").send(toListingsCsv(listings));
  });

  app.get("/api/exports/backup.json", async () => {
    const backup = db.createBackup();
    db.recordExport("json", backup.listings.length);
    return backup;
  });

  app.post("/api/import/backup", async (request, reply) => {
    const input = coerceBackupPayload(asObject(request.body));
    if (!input.ok) {
      return badRequest(reply, input.message);
    }

    const result = db.restoreBackup(input.value);
    const listings = db
      .listListings()
      .flatMap((listing) => {
        const recalculated = recalculateListing(db, listing.id);
        return recalculated ? [recalculated] : [];
      });

    return reply.send({
      listings,
      restored: result
    });
  });

  return app;
}

function recalculateListing(db: PamilaDatabase, id: string) {
  const listing = db.getListing(id);
  if (!listing) {
    return null;
  }

  const scoreBreakdown = calculateListingScore(listing, db.getSettings(), {
    commute: db.getCurrentCommuteEstimate(id),
    location: db.getCurrentLocation(id)
  });
  db.saveScoreBreakdown(id, scoreBreakdown);
  const scoredListing = db.getListing(id);
  return scoredListing ? listingForResponse(db, scoredListing) : null;
}

function listingForResponse(db: PamilaDatabase, listing: ListingWithScore) {
  const commute = db.getCurrentCommuteEstimate(listing.id);
  return {
    ...listing,
    commute,
    commuteEstimate: commute,
    lastCommuteCheckedAt: commute?.calculatedAt ?? null,
    location: db.getCurrentLocation(listing.id),
    routeDetail: commute?.routeDetail ?? null
  };
}

function corsOriginForRequest(origin: string | undefined, configuredOrigin: string) {
  if (!origin) {
    return configuredOrigin;
  }

  if (isLoopbackBrowserOrigin(origin)) {
    return origin;
  }

  const allowedOrigins = new Set([configuredOrigin]);
  try {
    const configuredUrl = new URL(configuredOrigin);
    const hostVariant =
      configuredUrl.hostname === "localhost"
        ? "127.0.0.1"
        : configuredUrl.hostname === "127.0.0.1"
          ? "localhost"
          : "";

    if (hostVariant) {
      configuredUrl.hostname = hostVariant;
      allowedOrigins.add(configuredUrl.toString().replace(/\/$/, ""));
    }
  } catch {
    // Fall through to the configured origin when the configured value is malformed.
  }

  return allowedOrigins.has(origin) ? origin : configuredOrigin;
}

function isLoopbackBrowserOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) &&
      parsed.port !== ""
    );
  } catch {
    return false;
  }
}

interface GeocodeListingResponse {
  status: "ok" | "missing_query" | "geocoder_unavailable" | "no_result";
  location: ListingLocation | null;
  listing: unknown;
  warnings: string[];
}

interface CalculateCommuteResponse {
  status: "ok" | "missing_location" | "otp_unavailable" | "otp_error" | "no_route";
  commute: CommuteSummary | null;
  listing: unknown;
  routeDetail: CommuteRouteDetail | null;
  warnings: string[];
  externalDirectionsUrl: string | null;
}

type PrepareCommuteStatus =
  | "ok"
  | "missing_location"
  | "geocoder_unavailable"
  | "no_result"
  | "otp_unavailable"
  | "otp_error"
  | "no_route";

type PrepareCommuteNextStep =
  | "add_location"
  | "enter_coordinates"
  | "retry_geocode"
  | "manual_commute"
  | "review_route";

interface PrepareCommuteResponse {
  status: PrepareCommuteStatus;
  location: ListingLocation | null;
  commute: CommuteSummary | null;
  listing: unknown;
  routeDetail: CommuteRouteDetail | null;
  warnings: string[];
  nextStep: PrepareCommuteNextStep;
  externalDirectionsUrl?: string | null;
}

type GeocodeLocationResult =
  | {
      status: "ok";
      lat: number;
      lng: number;
      warnings: string[];
    }
  | {
      status: "missing_query" | "geocoder_unavailable" | "no_result";
      warnings: string[];
    };

async function geocodeListingLocation(
  location: ListingLocation,
  options: {
    fetchImpl?: typeof fetch | undefined;
    geocoderUrl: string;
  }
): Promise<GeocodeLocationResult> {
  if (hasCoordinates(location)) {
    return {
      lat: location.lat,
      lng: location.lng,
      status: "ok",
      warnings: ["Location already has coordinates; using saved coordinates."]
    };
  }

  const query = buildGeocodeQuery(location);
  if (!query) {
    return {
      status: "missing_query",
      warnings: ["Add an address, cross streets, or neighborhood before geocoding."]
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    return {
      status: "geocoder_unavailable",
      warnings: ["No fetch implementation is available for geocoding."]
    };
  }

  const url = new URL(options.geocoderUrl);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", query);

  try {
    const response = await fetchImpl(url, {
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "PAMILA local apartment search (personal use)"
      }
    });

    if (!response.ok) {
      return {
        status: "geocoder_unavailable",
        warnings: [`Geocoder returned HTTP ${response.status}.`]
      };
    }

    const payload = await response.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    if (!first || typeof first !== "object") {
      return {
        status: "no_result",
        warnings: [`No geocoding result found for "${query}".`]
      };
    }

    const result = first as Record<string, unknown>;
    const lat = parseCoordinate(result.lat);
    const lng = parseCoordinate(result.lon);
    if (lat === null || lng === null || !isFiniteCoordinatePair(lat, lng)) {
      return {
        status: "no_result",
        warnings: [`Geocoder result for "${query}" did not include usable coordinates.`]
      };
    }

    return {
      lat,
      lng,
      status: "ok",
      warnings: []
    };
  } catch (error) {
    return {
      status: "geocoder_unavailable",
      warnings: [error instanceof Error ? error.message : "Geocoder request failed."]
    };
  }
}

function buildGeocodeQuery(location: ListingLocation) {
  const core = [location.address, location.crossStreets, location.neighborhood, location.label]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));

  if (!core) {
    return "";
  }

  return /new york|nyc|brooklyn|queens/i.test(core) ? core : `${core}, New York, NY`;
}

function applyBestApproximateLocationFromCaptures(
  db: PamilaDatabase,
  listing: ListingWithScore
): ListingLocation | null {
  const candidates = db
    .listCapturesByListing(listing.id)
    .map((capture) => buildCaptureCleanupSuggestions(capture).locationSuggestion)
    .filter((location): location is UpsertLocationInput => location !== null)
    .sort((left, right) => locationConfidenceRank(right.confidence) - locationConfidenceRank(left.confidence));

  const best = candidates[0];
  if (!best) {
    return null;
  }

  return db.upsertListingLocation(listing.id, {
    ...best,
    confidence: best.confidence ?? "low",
    isUserConfirmed: best.isUserConfirmed ?? false
  });
}

function locationConfidenceRank(confidence: UpsertLocationInput["confidence"]) {
  switch (confidence) {
    case "exact":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
    case undefined:
      return 1;
  }
}

function prepareGeocodeWarnings(status: GeocodeLocationResult["status"], warnings: string[]) {
  switch (status) {
    case "missing_query":
      return ["No location text was captured yet."];
    case "no_result":
      return ["Could not find coordinates for this location; enter lat/lng manually."];
    case "geocoder_unavailable":
      return uniqueStrings(["Geocoder is unavailable; enter lat/lng manually or try again.", ...warnings]);
    case "ok":
      return warnings;
  }
}

function nextStepForGeocodeStatus(status: GeocodeLocationResult["status"]): PrepareCommuteNextStep {
  switch (status) {
    case "missing_query":
      return "add_location";
    case "no_result":
      return "enter_coordinates";
    case "geocoder_unavailable":
      return "retry_geocode";
    case "ok":
      return "review_route";
  }
}

function prepareOtpWarning(status: PrepareCommuteStatus, message: string) {
  switch (status) {
    case "otp_unavailable":
      return "OTP is not running; manual commute still works.";
    case "no_route":
      return "OTP is running but did not return a transit route.";
    case "missing_location":
      return "Could not find coordinates for this location; enter lat/lng manually.";
    default:
      return message;
  }
}

function nextStepForOtpStatus(status: PrepareCommuteStatus): PrepareCommuteNextStep {
  switch (status) {
    case "missing_location":
      return "enter_coordinates";
    case "otp_unavailable":
    case "otp_error":
    case "no_route":
      return "manual_commute";
    default:
      return "review_route";
  }
}

function isApproximateLocation(location: ListingLocation) {
  return (
    location.source === "airbnb_approx_pin" ||
    location.source === "neighborhood" ||
    location.confidence === "low"
  );
}

function parseCoordinate(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function hasCoordinates(
  location: ListingLocation | null
): location is ListingLocation & { lat: number; lng: number } {
  return location !== null && isFiniteCoordinatePair(location.lat, location.lng);
}

function isFiniteCoordinatePair(lat: number | null, lng: number | null): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

interface CaptureAnalysisRuntimeOptions {
  fetchImpl?: typeof fetch | undefined;
  openAiApiKey: string | null | undefined;
  openAiModel: string;
}

function applyCaptureSuggestions(
  db: PamilaDatabase,
  listing: ListingWithScore,
  suggestions: CaptureCleanupSuggestions,
  approxLocation: CaptureImportInput["approxLocation"]
) {
  const patch = missingOnlyListingPatch(listing, suggestions.suggestedListingUpdate);
  if (Object.keys(patch).length > 0) {
    db.updateListing(listing.id, patch);
  }

  if (!db.getCurrentLocation(listing.id)) {
    if (approxLocation) {
      db.upsertListingLocation(listing.id, {
        address: approxLocation.address,
        confidence: approxLocation.confidence,
        crossStreets: approxLocation.crossStreets,
        geographyCategory: approxLocation.geographyCategory,
        isUserConfirmed: approxLocation.isUserConfirmed,
        label: approxLocation.label,
        lat: approxLocation.lat,
        lng: approxLocation.lng,
        neighborhood: approxLocation.neighborhood,
        source: approxLocation.source
      });
    } else if (suggestions.locationSuggestion) {
      db.upsertListingLocation(listing.id, suggestions.locationSuggestion);
    }
  }
}

function missingOnlyListingPatch(
  listing: ListingWithScore,
  suggestions: UpdateListingInput
): UpdateListingInput {
  const patch: UpdateListingInput = {};

  if (isBlankTitle(listing.title) && suggestions.title !== undefined) patch.title = suggestions.title;
  if (listing.monthlyRent === null && suggestions.monthlyRent !== undefined) patch.monthlyRent = suggestions.monthlyRent;
  if (listing.knownTotalFees === null && suggestions.knownTotalFees !== undefined) patch.knownTotalFees = suggestions.knownTotalFees;
  if (listing.stayType === "unknown" && suggestions.stayType !== undefined) patch.stayType = suggestions.stayType;
  if (listing.bedroomCount === null && suggestions.bedroomCount !== undefined) patch.bedroomCount = suggestions.bedroomCount;
  if (listing.bedroomLabel === null && suggestions.bedroomLabel !== undefined) patch.bedroomLabel = suggestions.bedroomLabel;
  if (listing.bathroomType === "unknown" && suggestions.bathroomType !== undefined) patch.bathroomType = suggestions.bathroomType;
  if (listing.kitchen === "unknown" && suggestions.kitchen !== undefined) patch.kitchen = suggestions.kitchen;
  if (listing.washer === "unknown" && suggestions.washer !== undefined) patch.washer = suggestions.washer;
  if (listing.furnished === "unknown" && suggestions.furnished !== undefined) patch.furnished = suggestions.furnished;
  if (listing.availabilitySummary === null && suggestions.availabilitySummary !== undefined) {
    patch.availabilitySummary = suggestions.availabilitySummary;
  }
  if (listing.earliestMoveIn === null && suggestions.earliestMoveIn !== undefined) patch.earliestMoveIn = suggestions.earliestMoveIn;
  if (listing.latestMoveIn === null && suggestions.latestMoveIn !== undefined) patch.latestMoveIn = suggestions.latestMoveIn;
  if (listing.earliestMoveOut === null && suggestions.earliestMoveOut !== undefined) patch.earliestMoveOut = suggestions.earliestMoveOut;
  if (listing.latestMoveOut === null && suggestions.latestMoveOut !== undefined) patch.latestMoveOut = suggestions.latestMoveOut;
  if (!listing.monthToMonth && suggestions.monthToMonth !== undefined) patch.monthToMonth = suggestions.monthToMonth;
  if (!listing.nextAction && suggestions.nextAction !== undefined) patch.nextAction = suggestions.nextAction;

  return patch;
}

async function maybeAnalyzeCaptureOnImport(
  db: PamilaDatabase,
  capture: CaptureRecord,
  options: CaptureAnalysisRuntimeOptions
) {
  if (!db.getSettings().aiOnCaptureEnabled || !options.openAiApiKey) {
    return null;
  }

  try {
    return await analyzeCaptureForResponse(db, capture, options);
  } catch {
    return {
      cached: false,
      enabled: true,
      error: "OpenAI analysis failed; deterministic suggestions were still saved.",
      source: "openai"
    };
  }
}

async function analyzeCaptureForResponse(
  db: PamilaDatabase,
  capture: CaptureRecord,
  options: CaptureAnalysisRuntimeOptions
) {
  const suggestions = buildCaptureCleanupSuggestions(capture);

  if (!db.getSettings().aiOnCaptureEnabled) {
    return {
      analysis: null,
      cached: false,
      enabled: false,
      reason: "ai_disabled",
      suggestions
    };
  }

  if (!options.openAiApiKey) {
    return {
      analysis: null,
      cached: false,
      enabled: false,
      reason: "missing_openai_api_key",
      suggestions
    };
  }

  const cached = db.getAiAnalysisByInputHash(suggestions.inputHash);
  if (cached) {
    return {
      analysis: cached,
      cached: true,
      enabled: true,
      suggestions
    };
  }

  const openAiAnalysis = await analyzeCaptureWithOpenAI(capture, suggestions, {
    apiKey: options.openAiApiKey,
    fetchImpl: options.fetchImpl,
    model: options.openAiModel
  });
  const analysis = db.saveAiAnalysis({
    analysis: openAiAnalysis as Record<string, unknown>,
    inputHash: suggestions.inputHash,
    listingId: capture.listingId,
    model: options.openAiModel
  });

  return {
    analysis,
    cached: false,
    enabled: true,
    suggestions
  };
}

function isBlankTitle(title: string) {
  return /^untitled\b/i.test(title.trim());
}

function coerceCreateListing(body: Record<string, unknown>):
  | { ok: true; value: CreateListingInput }
  | { ok: false; message: string } {
  if (!isListingSource(body.source)) {
    return { ok: false, message: "source must be airbnb or leasebreak." };
  }

  const sourceUrl = stringValue(body.sourceUrl);
  if (!sourceUrl) {
    return { ok: false, message: "sourceUrl is required." };
  }

  return {
    ok: true,
    value: compact({
      availabilitySummary: nullableStringValue(body.availabilitySummary),
      bathroomType: bathroomTypeValue(body.bathroomType),
      bedroomCount: nullableNumberValue(body.bedroomCount),
      bedroomLabel: nullableStringValue(body.bedroomLabel),
      canonicalSourceUrl: stringValue(body.canonicalSourceUrl),
      earliestMoveIn: nullableStringValue(body.earliestMoveIn),
      earliestMoveOut: nullableStringValue(body.earliestMoveOut),
      furnished: yesNoUnknownValue(body.furnished),
      kitchen: yesNoUnknownValue(body.kitchen),
      knownTotalFees: nullableNumberValue(body.knownTotalFees),
      latestMoveIn: nullableStringValue(body.latestMoveIn),
      latestMoveOut: nullableStringValue(body.latestMoveOut),
      monthToMonth: booleanValue(body.monthToMonth),
      monthlyRent: nullableNumberValue(body.monthlyRent),
      nextAction: nullableStringValue(body.nextAction),
      source: body.source,
      sourceUrl,
      status: listingStatusValue(body.status),
      stayType: stayTypeValue(body.stayType),
      title: stringValue(body.title),
      userNotes: nullableStringValue(body.userNotes),
      washer: washerValue(body.washer)
    })
  };
}

function coerceUpdateListing(body: Record<string, unknown>): UpdateListingInput {
  return compact({
    availabilitySummary: nullableStringValue(body.availabilitySummary),
    bathroomType: bathroomTypeValue(body.bathroomType),
    bedroomCount: nullableNumberValue(body.bedroomCount),
    bedroomLabel: nullableStringValue(body.bedroomLabel),
    canonicalSourceUrl: stringValue(body.canonicalSourceUrl),
    earliestMoveIn: nullableStringValue(body.earliestMoveIn),
    earliestMoveOut: nullableStringValue(body.earliestMoveOut),
    furnished: yesNoUnknownValue(body.furnished),
    kitchen: yesNoUnknownValue(body.kitchen),
    knownTotalFees: nullableNumberValue(body.knownTotalFees),
    latestMoveIn: nullableStringValue(body.latestMoveIn),
    latestMoveOut: nullableStringValue(body.latestMoveOut),
    monthToMonth: booleanValue(body.monthToMonth),
    monthlyRent: nullableNumberValue(body.monthlyRent),
    nextAction: nullableStringValue(body.nextAction),
    source: isListingSource(body.source) ? body.source : undefined,
    sourceUrl: stringValue(body.sourceUrl),
    status: listingStatusValue(body.status),
    stayType: stayTypeValue(body.stayType),
    title: stringValue(body.title),
    userNotes: nullableStringValue(body.userNotes),
    washer: washerValue(body.washer)
  });
}

function coerceSettingsUpdate(body: Record<string, unknown>) {
  return compact({
    acceptableCommuteMinutes: numberValue(body.acceptableCommuteMinutes),
    aiOnCaptureEnabled: booleanValue(body.aiOnCaptureEnabled),
    defaultBedroomFilter: bedroomFilterValue(body.defaultBedroomFilter),
    fallbackStayType: stayTypeValue(body.fallbackStayType),
    heavyWalkMinutes: numberValue(body.heavyWalkMinutes),
    idealCommuteMinutes: numberValue(body.idealCommuteMinutes),
    longWalkMinutes: numberValue(body.longWalkMinutes),
    maxMonthlyRent: numberValue(body.maxMonthlyRent),
    normalStayType: stayTypeValue(body.normalStayType),
    officeAddress: stringValue(body.officeAddress),
    officeLat: nullableNumberValue(body.officeLat),
    officeLng: nullableNumberValue(body.officeLng),
    officeName: stringValue(body.officeName),
    panicModeEnabled: booleanValue(body.panicModeEnabled),
    targetEnd: stringValue(body.targetEnd),
    targetStartPrimary: stringValue(body.targetStartPrimary),
    targetStartSecondary: stringValue(body.targetStartSecondary)
  }) satisfies Partial<Omit<SettingsRecord, "createdAt" | "id" | "updatedAt">>;
}

function coerceLocationUpdate(rawBody: Record<string, unknown>): UpsertLocationInput {
  const nestedLocation = asObject(rawBody.location);
  const body = Object.keys(nestedLocation).length > 0 ? nestedLocation : rawBody;

  return compact({
    address: nullableStringValue(body.address),
    confidence: locationConfidenceValue(body.confidence),
    crossStreets: nullableStringValue(body.crossStreets),
    geographyCategory: geographyCategoryValue(body.geographyCategory),
    isUserConfirmed: booleanValue(body.isUserConfirmed),
    label: nullableStringValue(body.label),
    lat: nullableNumberValue(body.lat),
    lng: nullableNumberValue(body.lng),
    neighborhood: nullableStringValue(body.neighborhood),
    source: locationSourceValue(body.source)
  });
}

function coerceCommuteUpdate(rawBody: Record<string, unknown>): UpsertCommuteEstimateInput {
  const nestedCommute = asObject(rawBody.commute);
  const body = Object.keys(nestedCommute).length > 0 ? nestedCommute : rawBody;

  return compact({
    calculatedAt: stringValue(body.calculatedAt) ?? stringValue(rawBody.checkedAt),
    confidence: commuteConfidenceValue(body.confidence) ?? "manual",
    hasBusHeavyRoute: booleanValue(body.hasBusHeavyRoute),
    lineNames: stringArrayValue(body.lineNames),
    routeDetail: commuteRouteDetailValue(body.routeDetail),
    routeSummary: nullableStringValue(body.routeSummary),
    totalMinutes: nullableNumberValue(body.totalMinutes),
    transferCount: nullableNumberValue(body.transferCount),
    walkMinutes: nullableNumberValue(body.walkMinutes)
  });
}

function coerceCaptureImport(body: Record<string, unknown>):
  | { ok: true; value: CaptureImportInput }
  | { ok: false; message: string } {
  if (!isListingSource(body.source)) {
    return { ok: false, message: "source must be airbnb or leasebreak." };
  }

  const url = stringValue(body.url);
  if (!url) {
    return { ok: false, message: "url is required." };
  }

  const optionalCaptureFields = compact({
    capturedAt: stringValue(body.capturedAt),
    pageHash: nullableStringValue(body.pageHash)
  });

  return {
    ok: true,
    value: {
      approxLocation: listingLocationValue(body.approxLocation),
      captureMethod:
        body.captureMethod === "manual_form" || body.captureMethod === "manual_paste"
          ? body.captureMethod
          : "extension",
      pageText: nullableStringValue(body.pageText) ?? null,
      selectedText: nullableStringValue(body.selectedText) ?? null,
      source: body.source,
      thumbnailCandidates: thumbnailCandidatesValue(body.thumbnailCandidates),
      title: nullableStringValue(body.title) ?? null,
      url,
      visibleFields: visibleFieldsValue(body.visibleFields),
      ...optionalCaptureFields
    }
  };
}

function coerceBackupPayload(body: Record<string, unknown>):
  | { ok: true; value: BackupPayload }
  | { ok: false; message: string } {
  if (!Array.isArray(body.listings)) {
    return { ok: false, message: "backup listings array is required." };
  }
  if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
    return { ok: false, message: "backup settings object is required." };
  }

  return {
    ok: true,
    value: body as unknown as BackupPayload
  };
}

function toListingsCsv(listings: ListingWithScore[]) {
  const headers = [
    "id",
    "source",
    "title",
    "sourceUrl",
    "monthlyRent",
    "stayType",
    "bedroomCount",
    "status",
    "totalScore",
    "hardFilterStatus",
    "nextAction"
  ];

  const rows = listings.map((listing) => [
    listing.id,
    listing.source,
    listing.title,
    listing.sourceUrl,
    listing.monthlyRent ?? "",
    listing.stayType,
    listing.bedroomCount ?? "",
    listing.status,
    listing.scoreBreakdown?.totalScore ?? "",
    listing.scoreBreakdown?.hardFilterStatus ?? "",
    listing.nextAction ?? ""
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: unknown) {
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function getRouteId(params: unknown) {
  const object = asObject(params);
  const id = stringValue(object.id);
  return id ?? "";
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: "bad_request", message });
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: "not_found", message });
}

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function compact<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as undefined extends T[K] ? K : K]: Exclude<T[K], undefined>;
  };
}

function stringValue(input: unknown) {
  return typeof input === "string" && input.trim() ? input.trim() : undefined;
}

function nullableStringValue(input: unknown) {
  if (input === null) return null;
  return stringValue(input);
}

function numberValue(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function nullableNumberValue(input: unknown) {
  if (input === null) return null;
  return numberValue(input);
}

function booleanValue(input: unknown) {
  return typeof input === "boolean" ? input : undefined;
}

function isListingSource(input: unknown): input is ListingSource {
  return typeof input === "string" && LISTING_SOURCES.includes(input as ListingSource);
}

function isListingStatus(input: unknown): input is ListingStatus {
  return typeof input === "string" && LISTING_STATUSES.includes(input as ListingStatus);
}

function listingStatusValue(input: unknown): ListingStatus | undefined {
  return isListingStatus(input) ? input : undefined;
}

function stayTypeValue(input: unknown): StayType | undefined {
  return typeof input === "string" && STAY_TYPES.includes(input as StayType)
    ? (input as StayType)
    : undefined;
}

function bedroomFilterValue(input: unknown): BedroomFilter | undefined {
  return typeof input === "string" && BEDROOM_FILTERS.includes(input as BedroomFilter)
    ? (input as BedroomFilter)
    : undefined;
}

function bathroomTypeValue(input: unknown): "private" | "shared" | "unknown" | undefined {
  return input === "private" || input === "shared" || input === "unknown" ? input : undefined;
}

function yesNoUnknownValue(input: unknown): "yes" | "no" | "unknown" | undefined {
  return input === "yes" || input === "no" || input === "unknown" ? input : undefined;
}

function washerValue(input: unknown): "in_unit" | "in_building" | "nearby" | "no" | "unknown" | undefined {
  return input === "in_unit" ||
    input === "in_building" ||
    input === "nearby" ||
    input === "no" ||
    input === "unknown"
    ? input
    : undefined;
}

function geographyCategoryValue(input: unknown): UpsertLocationInput["geographyCategory"] | undefined {
  return input === "manhattan" ||
    input === "lic_astoria" ||
    input === "brooklyn" ||
    input === "other" ||
    input === "unknown"
    ? input
    : undefined;
}

function locationSourceValue(input: unknown): UpsertLocationInput["source"] | undefined {
  return input === "exact_address" ||
    input === "cross_streets" ||
    input === "airbnb_approx_pin" ||
    input === "neighborhood" ||
    input === "manual_guess"
    ? input
    : undefined;
}

function locationConfidenceValue(input: unknown): UpsertLocationInput["confidence"] | undefined {
  return input === "exact" || input === "high" || input === "medium" || input === "low"
    ? input
    : undefined;
}

function commuteConfidenceValue(input: unknown): UpsertCommuteEstimateInput["confidence"] | undefined {
  return input === "exact" || input === "estimated" || input === "manual" ? input : undefined;
}

function commuteRouteDetailValue(input: unknown): CommuteRouteDetail | undefined {
  const object = asObject(input);
  return Array.isArray(object.legs) ? (object as unknown as CommuteRouteDetail) : undefined;
}

function stringArrayValue(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  return input.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function listingLocationValue(input: unknown): CaptureImportInput["approxLocation"] {
  const object = asObject(input);
  const label = stringValue(object.label);
  if (!label) {
    return null;
  }

  return {
    address: nullableStringValue(object.address) ?? null,
    confidence: locationConfidenceValue(object.confidence) ?? "low",
    crossStreets: nullableStringValue(object.crossStreets) ?? null,
    geographyCategory: geographyCategoryValue(object.geographyCategory) ?? "unknown",
    isUserConfirmed: booleanValue(object.isUserConfirmed) ?? false,
    label,
    lat: nullableNumberValue(object.lat) ?? null,
    lng: nullableNumberValue(object.lng) ?? null,
    neighborhood: nullableStringValue(object.neighborhood) ?? null,
    source: locationSourceValue(object.source) ?? "airbnb_approx_pin"
  };
}

function visibleFieldsValue(input: unknown): Record<string, string> {
  const object = asObject(input);
  return Object.fromEntries(
    Object.entries(object).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function thumbnailCandidatesValue(input: unknown): CaptureImportInput["thumbnailCandidates"] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((candidate) => {
    const object = asObject(candidate);
    const url = stringValue(object.url);
    if (!url) {
      return [];
    }
    return [
      {
        height: nullableNumberValue(object.height) ?? null,
        url,
        width: nullableNumberValue(object.width) ?? null
      }
    ];
  });
}

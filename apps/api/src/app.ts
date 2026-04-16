import Fastify, { type FastifyReply } from "fastify";
import {
  connectPamilaDb,
  type CaptureImportInput,
  type CreateListingInput,
  type ListListingsOptions,
  type ListingRecord,
  type ListingWithScore,
  type PamilaDatabase,
  type SettingsRecord,
  type UpdateListingInput
} from "@pamila/db";
import {
  BEDROOM_FILTERS,
  LISTING_SOURCES,
  LISTING_STATUSES,
  STAY_TYPES,
  type BedroomFilter,
  type ListingSource,
  type ListingStatus,
  type StayType
} from "@pamila/core";

import { loadApiConfig } from "./config.js";
import { calculateListingScore } from "./scoring.js";

export interface BuildAppOptions {
  db?: PamilaDatabase;
  databaseUrl?: string;
  token?: string;
}

export function buildApp(options: BuildAppOptions = {}) {
  const config = loadApiConfig();
  const db = options.db ?? connectPamilaDb({ databaseUrl: options.databaseUrl ?? config.databaseUrl });
  const localToken = options.token ?? config.localToken;
  const ownsDb = !options.db;

  const app = Fastify({
    logger: false
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", config.webOrigin);
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
      listings: db.listListings(options)
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
    return { listing };
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

  app.post("/api/captures", async (request, reply) => {
    const input = coerceCaptureImport(asObject(request.body));
    if (!input.ok) {
      return badRequest(reply, input.message);
    }

    const imported = db.importCapture(input.value);
    const listing = recalculateListing(db, imported.listing.id);
    return reply.code(201).send({
      capture: imported.capture,
      listing
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
      .map((listing) => recalculateListing(db, listing.id))
      .filter((listing): listing is ListingWithScore => listing !== null);

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

  return app;
}

function recalculateListing(db: PamilaDatabase, id: string) {
  const listing = db.getListing(id);
  if (!listing) {
    return null;
  }

  const scoreBreakdown = calculateListingScore(listing, db.getSettings());
  db.saveScoreBreakdown(id, scoreBreakdown);
  return db.getListing(id);
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
      approxLocation: null,
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

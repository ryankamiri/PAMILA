import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { canonicalizeListingUrl, DEFAULT_SEARCH_SETTINGS, type ScoreBreakdown } from "@pamila/core";

import { runMigrations } from "./migrations.js";
import {
  scoreBreakdowns,
  settings,
  listings,
  schema,
  sourceCaptures,
  statusEvents
} from "./schema.js";
import type {
  BackupPayload,
  CaptureImportInput,
  CaptureRecord,
  CreateListingInput,
  DatabaseOptions,
  ListListingsOptions,
  ListingRecord,
  ListingWithScore,
  SettingsRecord,
  StoredScoreBreakdown,
  UpdateListingInput
} from "./types.js";
import { DEFAULT_SETTINGS_ID } from "./types.js";

type Db = BetterSQLite3Database<typeof schema>;
type ListingRow = typeof listings.$inferSelect;
type SettingsRow = typeof settings.$inferSelect;
type CaptureRow = typeof sourceCaptures.$inferSelect;
type ScoreRow = typeof scoreBreakdowns.$inferSelect;

export class PamilaDatabase {
  readonly db: Db;
  readonly sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
    this.db = drizzle(sqlite, { schema });
  }

  initialize(options: { migrate?: boolean; seed?: boolean } = {}) {
    if (options.migrate !== false) {
      runMigrations(this.sqlite);
    }

    if (options.seed !== false) {
      this.seedDefaultSettings();
    }
  }

  close() {
    this.sqlite.close();
  }

  seedDefaultSettings() {
    const existing = this.db
      .select()
      .from(settings)
      .where(eq(settings.id, DEFAULT_SETTINGS_ID))
      .get();

    if (existing) {
      return mapSettings(existing);
    }

    const now = new Date().toISOString();
    const record = {
      acceptableCommuteMinutes: DEFAULT_SEARCH_SETTINGS.acceptableCommuteMinutes,
      aiOnCaptureEnabled: false,
      createdAt: now,
      defaultBedroomFilter: DEFAULT_SEARCH_SETTINGS.defaultBedroomFilter,
      fallbackStayType: DEFAULT_SEARCH_SETTINGS.fallbackStayType,
      heavyWalkMinutes: DEFAULT_SEARCH_SETTINGS.heavyWalkMinutes,
      id: DEFAULT_SETTINGS_ID,
      idealCommuteMinutes: DEFAULT_SEARCH_SETTINGS.idealCommuteMinutes,
      longWalkMinutes: DEFAULT_SEARCH_SETTINGS.longWalkMinutes,
      maxMonthlyRent: DEFAULT_SEARCH_SETTINGS.maxMonthlyRent,
      normalStayType: DEFAULT_SEARCH_SETTINGS.normalStayType,
      officeAddress: DEFAULT_SEARCH_SETTINGS.officeAddress,
      officeLat: null,
      officeLng: null,
      officeName: DEFAULT_SEARCH_SETTINGS.officeName,
      panicModeEnabled: DEFAULT_SEARCH_SETTINGS.panicModeEnabled,
      targetEnd: DEFAULT_SEARCH_SETTINGS.targetEnd,
      targetStartPrimary: DEFAULT_SEARCH_SETTINGS.targetStartPrimary,
      targetStartSecondary: DEFAULT_SEARCH_SETTINGS.targetStartSecondary,
      updatedAt: now
    } satisfies typeof settings.$inferInsert;

    this.db.insert(settings).values(record).run();
    return mapSettings(record);
  }

  getSettings() {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.id, DEFAULT_SETTINGS_ID))
      .get();

    return row ? mapSettings(row) : this.seedDefaultSettings();
  }

  updateSettings(input: Partial<Omit<SettingsRecord, "id" | "createdAt" | "updatedAt">>) {
    const now = new Date().toISOString();
    const values = stripUndefined({
      acceptableCommuteMinutes: input.acceptableCommuteMinutes,
      aiOnCaptureEnabled: input.aiOnCaptureEnabled,
      defaultBedroomFilter: input.defaultBedroomFilter,
      fallbackStayType: input.fallbackStayType,
      heavyWalkMinutes: input.heavyWalkMinutes,
      idealCommuteMinutes: input.idealCommuteMinutes,
      longWalkMinutes: input.longWalkMinutes,
      maxMonthlyRent: input.maxMonthlyRent,
      normalStayType: input.normalStayType,
      officeAddress: input.officeAddress,
      officeLat: input.officeLat,
      officeLng: input.officeLng,
      officeName: input.officeName,
      panicModeEnabled: input.panicModeEnabled,
      targetEnd: input.targetEnd,
      targetStartPrimary: input.targetStartPrimary,
      targetStartSecondary: input.targetStartSecondary,
      updatedAt: now
    });

    this.db.update(settings).set(values).where(eq(settings.id, DEFAULT_SETTINGS_ID)).run();
    return this.getSettings();
  }

  listListings(options: ListListingsOptions = {}): ListingWithScore[] {
    const rows = this.db.select().from(listings).orderBy(desc(listings.updatedAt)).all();

    return rows
      .map((row) => this.attachScore(mapListing(row)))
      .filter((listing) => (options.source ? listing.source === options.source : true))
      .filter((listing) => (options.status ? listing.status === options.status : true));
  }

  getListing(id: string): ListingWithScore | null {
    const row = this.db.select().from(listings).where(eq(listings.id, id)).get();
    return row ? this.attachScore(mapListing(row)) : null;
  }

  getListingByCanonicalUrl(canonicalSourceUrl: string): ListingWithScore | null {
    const row = this.db
      .select()
      .from(listings)
      .where(eq(listings.canonicalSourceUrl, canonicalSourceUrl))
      .get();

    return row ? this.attachScore(mapListing(row)) : null;
  }

  createListing(input: CreateListingInput): ListingWithScore {
    const now = new Date().toISOString();
    const id = randomUUID();
    const title = cleanTitle(input.title, input.source);
    const canonicalSourceUrl = input.canonicalSourceUrl ?? canonicalizeUrlForDb(input.sourceUrl);

    const values = {
      availabilitySummary: input.availabilitySummary ?? null,
      bathroomType: input.bathroomType ?? "unknown",
      bedroomCount: input.bedroomCount ?? null,
      bedroomLabel: input.bedroomLabel ?? null,
      canonicalSourceUrl,
      createdAt: now,
      earliestMoveIn: input.earliestMoveIn ?? null,
      earliestMoveOut: input.earliestMoveOut ?? null,
      furnished: input.furnished ?? "unknown",
      id,
      kitchen: input.kitchen ?? "unknown",
      knownTotalFees: input.knownTotalFees ?? null,
      latestMoveIn: input.latestMoveIn ?? null,
      latestMoveOut: input.latestMoveOut ?? null,
      monthToMonth: input.monthToMonth ?? false,
      monthlyRent: input.monthlyRent ?? null,
      nextAction: input.nextAction ?? null,
      source: input.source,
      sourceUrl: input.sourceUrl,
      status: input.status ?? "new",
      stayType: input.stayType ?? "unknown",
      title,
      updatedAt: now,
      userNotes: input.userNotes ?? null,
      washer: input.washer ?? "unknown"
    } satisfies typeof listings.$inferInsert;

    this.db.insert(listings).values(values).run();
    this.insertStatusEvent(id, null, values.status, "Listing created");
    return this.attachScore(mapListing(values));
  }

  updateListing(id: string, input: UpdateListingInput): ListingWithScore | null {
    const existing = this.getListing(id);
    if (!existing) {
      return null;
    }

    const nextStatus = input.status;
    const now = new Date().toISOString();
    const sourceUrl = input.sourceUrl;
    const values = stripUndefined({
      availabilitySummary: input.availabilitySummary,
      bathroomType: input.bathroomType,
      bedroomCount: input.bedroomCount,
      bedroomLabel: input.bedroomLabel,
      canonicalSourceUrl:
        input.canonicalSourceUrl ?? (sourceUrl ? canonicalizeUrlForDb(sourceUrl) : undefined),
      earliestMoveIn: input.earliestMoveIn,
      earliestMoveOut: input.earliestMoveOut,
      furnished: input.furnished,
      kitchen: input.kitchen,
      knownTotalFees: input.knownTotalFees,
      latestMoveIn: input.latestMoveIn,
      latestMoveOut: input.latestMoveOut,
      monthToMonth: input.monthToMonth,
      monthlyRent: input.monthlyRent,
      nextAction: input.nextAction,
      source: input.source,
      sourceUrl,
      status: nextStatus,
      stayType: input.stayType,
      title: input.title,
      updatedAt: now,
      userNotes: input.userNotes,
      washer: input.washer
    });

    this.db.update(listings).set(values).where(eq(listings.id, id)).run();

    if (nextStatus && nextStatus !== existing.status) {
      this.insertStatusEvent(id, existing.status, nextStatus, "Status updated");
    }

    return this.getListing(id);
  }

  deleteListing(id: string) {
    const result = this.db.delete(listings).where(eq(listings.id, id)).run();
    return result.changes > 0;
  }

  importCapture(input: CaptureImportInput): { capture: CaptureRecord; listing: ListingWithScore } {
    const canonicalSourceUrl = canonicalizeUrlForDb(input.url);
    const existing = this.getListingByCanonicalUrl(canonicalSourceUrl);
    const title = input.title ?? input.visibleFields.title ?? "Untitled imported listing";

    const listing =
      existing ??
      this.createListing({
        canonicalSourceUrl,
        nextAction: "Review imported capture and confirm key fields.",
        source: input.source,
        sourceUrl: input.url,
        status: "needs_cleanup",
        title
      });

    if (existing) {
      this.updateListing(existing.id, {
        nextAction: existing.nextAction ?? "Review latest capture.",
        title: existing.title === "Untitled imported listing" ? title : existing.title
      });
    }

    const now = input.capturedAt ?? new Date().toISOString();
    const values = {
      capturedAt: now,
      capturedText: input.pageText,
      capturedTitle: input.title,
      captureMethod: input.captureMethod ?? "extension",
      id: randomUUID(),
      listingId: listing.id,
      pageHash: input.pageHash ?? null,
      selectedText: input.selectedText,
      source: input.source,
      thumbnailCandidatesJson: JSON.stringify(input.thumbnailCandidates),
      url: input.url,
      visibleFieldsJson: JSON.stringify(input.visibleFields)
    } satisfies typeof sourceCaptures.$inferInsert;

    this.db.insert(sourceCaptures).values(values).run();

    return {
      capture: mapCapture(values),
      listing: this.getListing(listing.id) ?? listing
    };
  }

  saveScoreBreakdown(listingId: string, breakdown: ScoreBreakdown): StoredScoreBreakdown {
    this.db.delete(scoreBreakdowns).where(eq(scoreBreakdowns.listingId, listingId)).run();

    const values = {
      amenityScore: breakdown.amenityScore,
      calculatedAt: new Date().toISOString(),
      cleanupActionsJson: JSON.stringify(breakdown.cleanupActions),
      commuteScore: breakdown.commuteScore,
      dateScore: breakdown.dateScore,
      hardFilterReasonsJson: JSON.stringify(breakdown.hardFilterReasons),
      hardFilterStatus: breakdown.hardFilterStatus,
      id: randomUUID(),
      listingId,
      locationScore: breakdown.locationScore,
      priceScore: breakdown.priceScore,
      riskFlagsJson: JSON.stringify(breakdown.riskFlags),
      scoreExplanation: breakdown.scoreExplanation,
      stayBedroomScore: breakdown.stayBedroomScore,
      totalScore: breakdown.totalScore
    } satisfies typeof scoreBreakdowns.$inferInsert;

    this.db.insert(scoreBreakdowns).values(values).run();
    return mapScore(values);
  }

  listCaptures(): CaptureRecord[] {
    return this.db
      .select()
      .from(sourceCaptures)
      .orderBy(desc(sourceCaptures.capturedAt))
      .all()
      .map(mapCapture);
  }

  createBackup(): BackupPayload {
    return {
      captures: this.listCaptures(),
      exportedAt: new Date().toISOString(),
      listings: this.listListings(),
      settings: this.getSettings()
    };
  }

  recordExport(format: "csv" | "json", rowCount: number) {
    this.sqlite
      .prepare("INSERT INTO exports (id, format, row_count, created_at) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), format, rowCount, new Date().toISOString());
  }

  private attachScore(listing: ListingRecord): ListingWithScore {
    const score = this.db
      .select()
      .from(scoreBreakdowns)
      .where(eq(scoreBreakdowns.listingId, listing.id))
      .orderBy(desc(scoreBreakdowns.calculatedAt))
      .get();

    return {
      ...listing,
      scoreBreakdown: score ? mapScore(score) : null
    };
  }

  private insertStatusEvent(
    listingId: string,
    fromStatus: string | null,
    toStatus: string,
    note: string | null
  ) {
    this.db
      .insert(statusEvents)
      .values({
        createdAt: new Date().toISOString(),
        fromStatus,
        id: randomUUID(),
        listingId,
        note,
        toStatus
      })
      .run();
  }
}

export function connectPamilaDb(options: DatabaseOptions = {}) {
  const databasePath = databaseUrlToPath(options.databaseUrl ?? "file:data/pamila.sqlite");

  if (databasePath !== ":memory:" && !existsSync(dirname(databasePath))) {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  const pamilaDb = new PamilaDatabase(sqlite);
  pamilaDb.initialize(stripUndefined({ migrate: options.migrate, seed: options.seed }));
  return pamilaDb;
}

export function createInMemoryPamilaDb() {
  return connectPamilaDb({ databaseUrl: ":memory:" });
}

export function databaseUrlToPath(databaseUrl: string) {
  if (databaseUrl === ":memory:") {
    return databaseUrl;
  }

  if (databaseUrl.startsWith("file:")) {
    return resolve(databaseUrl.slice("file:".length));
  }

  return resolve(databaseUrl);
}

export function canonicalizeUrlForDb(url: string) {
  return canonicalizeListingUrl(url);
}

function mapSettings(row: SettingsRow): SettingsRecord {
  return {
    acceptableCommuteMinutes: row.acceptableCommuteMinutes,
    aiOnCaptureEnabled: row.aiOnCaptureEnabled,
    createdAt: row.createdAt,
    defaultBedroomFilter: row.defaultBedroomFilter as SettingsRecord["defaultBedroomFilter"],
    fallbackStayType: row.fallbackStayType as SettingsRecord["fallbackStayType"],
    heavyWalkMinutes: row.heavyWalkMinutes,
    id: row.id,
    idealCommuteMinutes: row.idealCommuteMinutes,
    longWalkMinutes: row.longWalkMinutes,
    maxMonthlyRent: row.maxMonthlyRent,
    normalStayType: row.normalStayType as SettingsRecord["normalStayType"],
    officeAddress: row.officeAddress,
    officeLat: row.officeLat,
    officeLng: row.officeLng,
    officeName: row.officeName,
    panicModeEnabled: row.panicModeEnabled,
    targetEnd: row.targetEnd,
    targetStartPrimary: row.targetStartPrimary,
    targetStartSecondary: row.targetStartSecondary,
    updatedAt: row.updatedAt
  };
}

function mapListing(row: ListingRow): ListingRecord {
  return {
    availabilitySummary: row.availabilitySummary,
    bathroomType: row.bathroomType as ListingRecord["bathroomType"],
    bedroomCount: row.bedroomCount,
    bedroomLabel: row.bedroomLabel,
    canonicalSourceUrl: row.canonicalSourceUrl,
    createdAt: row.createdAt,
    earliestMoveIn: row.earliestMoveIn,
    earliestMoveOut: row.earliestMoveOut,
    furnished: row.furnished as ListingRecord["furnished"],
    id: row.id,
    kitchen: row.kitchen as ListingRecord["kitchen"],
    knownTotalFees: row.knownTotalFees,
    latestMoveIn: row.latestMoveIn,
    latestMoveOut: row.latestMoveOut,
    monthToMonth: row.monthToMonth,
    monthlyRent: row.monthlyRent,
    nextAction: row.nextAction,
    source: row.source as ListingRecord["source"],
    sourceUrl: row.sourceUrl,
    status: row.status as ListingRecord["status"],
    stayType: row.stayType as ListingRecord["stayType"],
    title: row.title,
    updatedAt: row.updatedAt,
    userNotes: row.userNotes,
    washer: row.washer as ListingRecord["washer"]
  };
}

function mapCapture(row: CaptureRow): CaptureRecord {
  return {
    capturedAt: row.capturedAt,
    capturedText: row.capturedText,
    capturedTitle: row.capturedTitle,
    captureMethod: row.captureMethod as CaptureRecord["captureMethod"],
    id: row.id,
    listingId: row.listingId,
    pageHash: row.pageHash,
    selectedText: row.selectedText,
    source: row.source as CaptureRecord["source"],
    thumbnailCandidates: parseJsonArray(row.thumbnailCandidatesJson),
    url: row.url,
    visibleFields: parseJsonObject(row.visibleFieldsJson)
  };
}

function mapScore(row: ScoreRow): StoredScoreBreakdown {
  return {
    amenityScore: row.amenityScore,
    calculatedAt: row.calculatedAt,
    cleanupActions: parseJsonArray(row.cleanupActionsJson),
    commuteScore: row.commuteScore,
    dateScore: row.dateScore,
    hardFilterReasons: parseJsonArray(row.hardFilterReasonsJson),
    hardFilterStatus: row.hardFilterStatus as StoredScoreBreakdown["hardFilterStatus"],
    id: row.id,
    listingId: row.listingId,
    locationScore: row.locationScore,
    priceScore: row.priceScore,
    riskFlags: parseJsonArray(row.riskFlagsJson),
    scoreExplanation: row.scoreExplanation,
    stayBedroomScore: row.stayBedroomScore,
    totalScore: row.totalScore
  };
}

function stripUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function parseJsonObject(input: string): Record<string, string> {
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray<T = unknown>(input: string): T[] {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanTitle(title: string | null | undefined, source: string) {
  const fallback = source === "airbnb" ? "Untitled Airbnb listing" : "Untitled Leasebreak listing";
  return title?.trim() || fallback;
}

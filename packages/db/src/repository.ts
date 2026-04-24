import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  canonicalizeListingUrl,
  DEFAULT_SEARCH_SETTINGS,
  type CommuteRouteDetail,
  type CommuteRouteLeg,
  type ScoreBreakdown
} from "@pamila/core";

import { runMigrations } from "./migrations.js";
import {
  aiAnalyses,
  commuteEstimates,
  locations,
  scoreBreakdowns,
  settings,
  listings,
  schema,
  sourceCaptures,
  statusEvents
} from "./schema.js";
import type {
  BackupPayload,
  AiAnalysisRecord,
  CaptureImportInput,
  CaptureRecord,
  CommuteEstimateRecord,
  CreateListingInput,
  DatabaseOptions,
  ListListingsOptions,
  ListingRecord,
  ListingWithScore,
  LocationRecord,
  RestoreBackupResult,
  SaveAiAnalysisInput,
  SettingsRecord,
  StatusEventRecord,
  StoredScoreBreakdown,
  UpsertCommuteEstimateInput,
  UpsertLocationInput,
  UpdateListingInput
} from "./types.js";
import { DEFAULT_SETTINGS_ID } from "./types.js";

type Db = BetterSQLite3Database<typeof schema>;
type ListingRow = typeof listings.$inferSelect;
type SettingsRow = typeof settings.$inferSelect;
type CaptureRow = typeof sourceCaptures.$inferSelect;
type ScoreRow = typeof scoreBreakdowns.$inferSelect;
type LocationRow = typeof locations.$inferSelect;
type CommuteEstimateRow = typeof commuteEstimates.$inferSelect;
type AiAnalysisRow = typeof aiAnalyses.$inferSelect;
type StatusEventRow = typeof statusEvents.$inferSelect;

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

  getCapture(id: string): CaptureRecord | null {
    const row = this.db.select().from(sourceCaptures).where(eq(sourceCaptures.id, id)).get();
    return row ? mapCapture(row) : null;
  }

  listCapturesByListing(listingId: string): CaptureRecord[] {
    return this.db
      .select()
      .from(sourceCaptures)
      .where(eq(sourceCaptures.listingId, listingId))
      .orderBy(desc(sourceCaptures.capturedAt))
      .all()
      .map(mapCapture);
  }

  listLocations(listingId?: string): LocationRecord[] {
    const rows = listingId
      ? this.db
          .select()
          .from(locations)
          .where(eq(locations.listingId, listingId))
          .orderBy(desc(locations.updatedAt))
          .all()
      : this.db.select().from(locations).orderBy(desc(locations.updatedAt)).all();

    return rows.map(mapLocation);
  }

  getCurrentLocation(listingId: string): LocationRecord | null {
    return this.listLocations(listingId)[0] ?? null;
  }

  upsertListingLocation(listingId: string, input: UpsertLocationInput): LocationRecord | null {
    if (!this.getListing(listingId)) {
      return null;
    }

    const existing = this.getCurrentLocation(listingId);
    const now = new Date().toISOString();

    if (existing) {
      const values = stripUndefined({
        address: input.address,
        confidence: input.confidence,
        crossStreets: input.crossStreets,
        geographyCategory: input.geographyCategory,
        isUserConfirmed: input.isUserConfirmed,
        label: cleanLocationLabel(input.label, input, existing.label),
        lat: input.lat,
        lng: input.lng,
        neighborhood: input.neighborhood,
        source: input.source,
        updatedAt: now
      });

      this.db.update(locations).set(values).where(eq(locations.id, existing.id)).run();
      return this.getCurrentLocation(listingId);
    }

    const values = {
      address: input.address ?? null,
      confidence: input.confidence ?? "low",
      createdAt: now,
      crossStreets: input.crossStreets ?? null,
      geographyCategory: input.geographyCategory ?? "unknown",
      id: randomUUID(),
      isUserConfirmed: input.isUserConfirmed ?? false,
      label: cleanLocationLabel(input.label, input, "Unknown location"),
      lat: input.lat ?? null,
      listingId,
      lng: input.lng ?? null,
      neighborhood: input.neighborhood ?? null,
      source: input.source ?? "manual_guess",
      updatedAt: now
    } satisfies typeof locations.$inferInsert;

    this.db.insert(locations).values(values).run();
    return mapLocation(values);
  }

  listCommuteEstimates(listingId?: string): CommuteEstimateRecord[] {
    const rows = listingId
      ? this.db
          .select()
          .from(commuteEstimates)
          .where(eq(commuteEstimates.listingId, listingId))
          .orderBy(desc(commuteEstimates.calculatedAt))
          .all()
      : this.db.select().from(commuteEstimates).orderBy(desc(commuteEstimates.calculatedAt)).all();

    return rows.map(mapCommuteEstimate);
  }

  getCurrentCommuteEstimate(listingId: string): CommuteEstimateRecord | null {
    return this.listCommuteEstimates(listingId)[0] ?? null;
  }

  upsertManualCommuteEstimate(
    listingId: string,
    input: UpsertCommuteEstimateInput
  ): CommuteEstimateRecord | null {
    if (!this.getListing(listingId)) {
      return null;
    }

    const existing = this.getCurrentCommuteEstimate(listingId);
    const calculatedAt = input.calculatedAt ?? new Date().toISOString();

    if (existing) {
      const values = stripUndefined({
        calculatedAt,
        confidence: input.confidence ?? "manual",
        hasBusHeavyRoute: input.hasBusHeavyRoute,
        lineNamesJson: input.lineNames === undefined ? undefined : JSON.stringify(input.lineNames),
        routeDetailJson:
          input.routeDetail === undefined ? undefined : JSON.stringify(input.routeDetail),
        routeSummary: input.routeSummary,
        totalMinutes: input.totalMinutes,
        transferCount: input.transferCount,
        walkMinutes: input.walkMinutes
      });

      this.db.update(commuteEstimates).set(values).where(eq(commuteEstimates.id, existing.id)).run();
      return this.getCurrentCommuteEstimate(listingId);
    }

    const values = {
      calculatedAt,
      confidence: input.confidence ?? "manual",
      hasBusHeavyRoute: input.hasBusHeavyRoute ?? false,
      id: randomUUID(),
      lineNamesJson: JSON.stringify(input.lineNames ?? []),
      listingId,
      routeDetailJson: input.routeDetail === undefined ? null : JSON.stringify(input.routeDetail),
      routeSummary: input.routeSummary ?? null,
      totalMinutes: input.totalMinutes ?? null,
      transferCount: input.transferCount ?? null,
      walkMinutes: input.walkMinutes ?? null
    } satisfies typeof commuteEstimates.$inferInsert;

    this.db.insert(commuteEstimates).values(values).run();
    return mapCommuteEstimate(values);
  }

  getAiAnalysisByInputHash(inputHash: string): AiAnalysisRecord | null {
    const row = this.db
      .select()
      .from(aiAnalyses)
      .where(eq(aiAnalyses.inputHash, inputHash))
      .orderBy(desc(aiAnalyses.createdAt))
      .get();

    return row ? mapAiAnalysis(row) : null;
  }

  listAiAnalyses(listingId?: string): AiAnalysisRecord[] {
    const rows = listingId
      ? this.db
          .select()
          .from(aiAnalyses)
          .where(eq(aiAnalyses.listingId, listingId))
          .orderBy(desc(aiAnalyses.createdAt))
          .all()
      : this.db.select().from(aiAnalyses).orderBy(desc(aiAnalyses.createdAt)).all();

    return rows.map(mapAiAnalysis);
  }

  saveAiAnalysis(input: SaveAiAnalysisInput): AiAnalysisRecord {
    const values = {
      analysisJson: JSON.stringify(input.analysis),
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      inputHash: input.inputHash,
      listingId: input.listingId ?? null,
      model: input.model ?? null
    } satisfies typeof aiAnalyses.$inferInsert;

    this.db.insert(aiAnalyses).values(values).run();
    return mapAiAnalysis(values);
  }

  listStatusEvents(listingId?: string): StatusEventRecord[] {
    const rows = listingId
      ? this.db
          .select()
          .from(statusEvents)
          .where(eq(statusEvents.listingId, listingId))
          .orderBy(desc(statusEvents.createdAt))
          .all()
      : this.db.select().from(statusEvents).orderBy(desc(statusEvents.createdAt)).all();

    return rows.map(mapStatusEvent);
  }

  createBackup(): BackupPayload {
    return {
      aiAnalyses: this.listAiAnalyses(),
      commuteEstimates: this.listCommuteEstimates(),
      captures: this.listCaptures(),
      exportedAt: new Date().toISOString(),
      listings: this.listListings(),
      locations: this.listLocations(),
      statusEvents: this.listStatusEvents(),
      settings: this.getSettings()
    };
  }

  restoreBackup(input: BackupPayload): RestoreBackupResult {
    if (input.settings) {
      this.updateSettings(input.settings);
    }

    let listingsRestored = 0;
    for (const listing of input.listings ?? []) {
      this.restoreListing(listing);
      listingsRestored += 1;
    }

    let capturesRestored = 0;
    for (const capture of input.captures ?? []) {
      this.restoreCapture(capture);
      capturesRestored += 1;
    }

    let locationsRestored = 0;
    for (const location of input.locations ?? []) {
      this.restoreLocation(location);
      locationsRestored += 1;
    }

    let commuteEstimatesRestored = 0;
    for (const estimate of input.commuteEstimates ?? []) {
      this.restoreCommuteEstimate(estimate);
      commuteEstimatesRestored += 1;
    }

    let aiAnalysesRestored = 0;
    for (const analysis of input.aiAnalyses ?? []) {
      this.restoreAiAnalysis(analysis);
      aiAnalysesRestored += 1;
    }

    let statusEventsRestored = 0;
    for (const event of input.statusEvents ?? []) {
      this.restoreStatusEvent(event);
      statusEventsRestored += 1;
    }

    return {
      aiAnalysesRestored,
      capturesRestored,
      commuteEstimatesRestored,
      listingsRestored,
      locationsRestored,
      settingsRestored: Boolean(input.settings),
      statusEventsRestored
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

  private restoreListing(listing: ListingWithScore) {
    const canonicalSourceUrl = listing.canonicalSourceUrl || canonicalizeUrlForDb(listing.sourceUrl);
    const values = {
      availabilitySummary: listing.availabilitySummary,
      bathroomType: listing.bathroomType,
      bedroomCount: listing.bedroomCount,
      bedroomLabel: listing.bedroomLabel,
      canonicalSourceUrl,
      createdAt: listing.createdAt,
      earliestMoveIn: listing.earliestMoveIn,
      earliestMoveOut: listing.earliestMoveOut,
      furnished: listing.furnished,
      id: listing.id,
      kitchen: listing.kitchen,
      knownTotalFees: listing.knownTotalFees,
      latestMoveIn: listing.latestMoveIn,
      latestMoveOut: listing.latestMoveOut,
      monthToMonth: listing.monthToMonth,
      monthlyRent: listing.monthlyRent,
      nextAction: listing.nextAction,
      source: listing.source,
      sourceUrl: listing.sourceUrl,
      status: listing.status,
      stayType: listing.stayType,
      title: listing.title,
      updatedAt: listing.updatedAt,
      userNotes: listing.userNotes,
      washer: listing.washer
    } satisfies typeof listings.$inferInsert;

    const existing =
      this.db.select().from(listings).where(eq(listings.id, listing.id)).get() ??
      this.db.select().from(listings).where(eq(listings.canonicalSourceUrl, canonicalSourceUrl)).get();

    if (existing) {
      const { id: _id, ...updateValues } = values;
      this.db.update(listings).set(updateValues).where(eq(listings.id, existing.id)).run();
      return;
    }

    this.db.insert(listings).values(values).run();
  }

  private restoreCapture(capture: CaptureRecord) {
    const values = {
      capturedAt: capture.capturedAt,
      capturedText: capture.capturedText,
      capturedTitle: capture.capturedTitle,
      captureMethod: capture.captureMethod,
      id: capture.id,
      listingId: capture.listingId,
      pageHash: capture.pageHash,
      selectedText: capture.selectedText,
      source: capture.source,
      thumbnailCandidatesJson: JSON.stringify(capture.thumbnailCandidates),
      url: capture.url,
      visibleFieldsJson: JSON.stringify(capture.visibleFields)
    } satisfies typeof sourceCaptures.$inferInsert;

    const existing = this.db.select().from(sourceCaptures).where(eq(sourceCaptures.id, capture.id)).get();
    if (existing) {
      const { id: _id, ...updateValues } = values;
      this.db.update(sourceCaptures).set(updateValues).where(eq(sourceCaptures.id, capture.id)).run();
      return;
    }

    this.db.insert(sourceCaptures).values(values).run();
  }

  private restoreLocation(location: LocationRecord) {
    const values = {
      address: location.address,
      confidence: location.confidence,
      createdAt: location.createdAt,
      crossStreets: location.crossStreets,
      geographyCategory: location.geographyCategory,
      id: location.id,
      isUserConfirmed: location.isUserConfirmed,
      label: location.label,
      lat: location.lat,
      listingId: location.listingId,
      lng: location.lng,
      neighborhood: location.neighborhood,
      source: location.source,
      updatedAt: location.updatedAt
    } satisfies typeof locations.$inferInsert;

    const existing = this.db.select().from(locations).where(eq(locations.id, location.id)).get();
    if (existing) {
      const { id: _id, ...updateValues } = values;
      this.db.update(locations).set(updateValues).where(eq(locations.id, location.id)).run();
      return;
    }

    this.db.insert(locations).values(values).run();
  }

  private restoreCommuteEstimate(estimate: CommuteEstimateRecord) {
    const values = {
      calculatedAt: estimate.calculatedAt,
      confidence: estimate.confidence,
      hasBusHeavyRoute: estimate.hasBusHeavyRoute,
      id: estimate.id,
      lineNamesJson: JSON.stringify(estimate.lineNames),
      listingId: estimate.listingId,
      routeDetailJson: estimate.routeDetail ? JSON.stringify(estimate.routeDetail) : null,
      routeSummary: estimate.routeSummary,
      totalMinutes: estimate.totalMinutes,
      transferCount: estimate.transferCount,
      walkMinutes: estimate.walkMinutes
    } satisfies typeof commuteEstimates.$inferInsert;

    const existing = this.db
      .select()
      .from(commuteEstimates)
      .where(eq(commuteEstimates.id, estimate.id))
      .get();
    if (existing) {
      const { id: _id, ...updateValues } = values;
      this.db.update(commuteEstimates).set(updateValues).where(eq(commuteEstimates.id, estimate.id)).run();
      return;
    }

    this.db.insert(commuteEstimates).values(values).run();
  }

  private restoreAiAnalysis(analysis: AiAnalysisRecord) {
    const values = {
      analysisJson: JSON.stringify(analysis.analysis),
      createdAt: analysis.createdAt,
      id: analysis.id,
      inputHash: analysis.inputHash,
      listingId: analysis.listingId,
      model: analysis.model
    } satisfies typeof aiAnalyses.$inferInsert;

    const existing = this.db.select().from(aiAnalyses).where(eq(aiAnalyses.id, analysis.id)).get();
    if (existing) {
      const { id: _id, ...updateValues } = values;
      this.db.update(aiAnalyses).set(updateValues).where(eq(aiAnalyses.id, analysis.id)).run();
      return;
    }

    this.db.insert(aiAnalyses).values(values).run();
  }

  private restoreStatusEvent(event: StatusEventRecord) {
    const values = {
      createdAt: event.createdAt,
      fromStatus: event.fromStatus,
      id: event.id,
      listingId: event.listingId,
      note: event.note,
      toStatus: event.toStatus
    } satisfies typeof statusEvents.$inferInsert;

    const existing = this.db.select().from(statusEvents).where(eq(statusEvents.id, event.id)).get();
    if (existing) {
      const { id: _id, ...updateValues } = values;
      this.db.update(statusEvents).set(updateValues).where(eq(statusEvents.id, event.id)).run();
      return;
    }

    this.db.insert(statusEvents).values(values).run();
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

function mapLocation(row: LocationRow): LocationRecord {
  return {
    address: row.address,
    confidence: row.confidence as LocationRecord["confidence"],
    createdAt: row.createdAt,
    crossStreets: row.crossStreets,
    geographyCategory: row.geographyCategory as LocationRecord["geographyCategory"],
    id: row.id,
    isUserConfirmed: row.isUserConfirmed,
    label: row.label,
    lat: row.lat,
    listingId: row.listingId,
    lng: row.lng,
    neighborhood: row.neighborhood,
    source: row.source as LocationRecord["source"],
    updatedAt: row.updatedAt
  };
}

function mapCommuteEstimate(row: CommuteEstimateRow): CommuteEstimateRecord {
  return {
    calculatedAt: row.calculatedAt,
    confidence: row.confidence as CommuteEstimateRecord["confidence"],
    hasBusHeavyRoute: row.hasBusHeavyRoute,
    id: row.id,
    lineNames: parseJsonArray<string>(row.lineNamesJson).filter((value): value is string => typeof value === "string"),
    listingId: row.listingId,
    routeDetail: parseRouteDetail(row.routeDetailJson),
    routeSummary: row.routeSummary,
    totalMinutes: row.totalMinutes,
    transferCount: row.transferCount,
    walkMinutes: row.walkMinutes
  };
}

function mapAiAnalysis(row: AiAnalysisRow): AiAnalysisRecord {
  return {
    analysis: parseJsonObjectLoose(row.analysisJson),
    createdAt: row.createdAt,
    id: row.id,
    inputHash: row.inputHash,
    listingId: row.listingId,
    model: row.model
  };
}

function mapStatusEvent(row: StatusEventRow): StatusEventRecord {
  return {
    createdAt: row.createdAt,
    fromStatus: row.fromStatus,
    id: row.id,
    listingId: row.listingId,
    note: row.note,
    toStatus: row.toStatus
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

function parseJsonObjectLoose(input: string): Record<string, unknown> {
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

function parseRouteDetail(input: string | null): CommuteRouteDetail | null {
  if (!input) {
    return null;
  }

  try {
    const parsed = JSON.parse(input) as Partial<CommuteRouteDetail> | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.legs)) {
      return null;
    }

    return {
      calculatedAt: typeof parsed.calculatedAt === "string" ? parsed.calculatedAt : "",
      destinationLabel:
        typeof parsed.destinationLabel === "string" ? parsed.destinationLabel : "Ramp NYC",
      externalDirectionsUrl:
        typeof parsed.externalDirectionsUrl === "string" ? parsed.externalDirectionsUrl : null,
      legs: parsed.legs.map(normalizeRouteLeg).filter((leg): leg is CommuteRouteLeg => leg !== null),
      originLabel: typeof parsed.originLabel === "string" ? parsed.originLabel : null
    };
  } catch {
    return null;
  }
}

function normalizeRouteLeg(input: unknown): CommuteRouteLeg | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const leg = input as Partial<CommuteRouteLeg>;
  const mode = typeof leg.mode === "string" ? leg.mode : "UNKNOWN";
  const style: CommuteRouteLeg["style"] = ["walk", "rail", "bus", "ferry", "other"].includes(
    String(leg.style)
  )
    ? (leg.style as CommuteRouteLeg["style"])
    : "other";

  return {
    color: typeof leg.color === "string" ? leg.color : "#2e7d6b",
    dashArray: typeof leg.dashArray === "string" ? leg.dashArray : null,
    distanceMeters: typeof leg.distanceMeters === "number" ? leg.distanceMeters : null,
    durationMinutes: typeof leg.durationMinutes === "number" ? leg.durationMinutes : null,
    fromName: typeof leg.fromName === "string" ? leg.fromName : null,
    geometry: Array.isArray(leg.geometry)
      ? leg.geometry.filter(isRoutePoint).map((point) => [point[0], point[1]] as [number, number])
      : [],
    lineName: typeof leg.lineName === "string" ? leg.lineName : null,
    mode,
    routeLongName: typeof leg.routeLongName === "string" ? leg.routeLongName : null,
    style,
    toName: typeof leg.toName === "string" ? leg.toName : null
  };
}

function isRoutePoint(input: unknown): input is [number, number] {
  return (
    Array.isArray(input) &&
    input.length >= 2 &&
    typeof input[0] === "number" &&
    Number.isFinite(input[0]) &&
    typeof input[1] === "number" &&
    Number.isFinite(input[1])
  );
}

function cleanTitle(title: string | null | undefined, source: string) {
  const fallback = source === "airbnb" ? "Untitled Airbnb listing" : "Untitled Leasebreak listing";
  return title?.trim() || fallback;
}

function cleanLocationLabel(
  label: string | null | undefined,
  input: Pick<UpsertLocationInput, "address" | "crossStreets" | "neighborhood">,
  fallback: string
) {
  return label?.trim() || input.address?.trim() || input.crossStreets?.trim() || input.neighborhood?.trim() || fallback;
}

import { relations } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  officeName: text("office_name").notNull(),
  officeAddress: text("office_address").notNull(),
  officeLat: real("office_lat"),
  officeLng: real("office_lng"),
  targetStartPrimary: text("target_start_primary").notNull(),
  targetStartSecondary: text("target_start_secondary").notNull(),
  targetEnd: text("target_end").notNull(),
  maxMonthlyRent: integer("max_monthly_rent").notNull(),
  defaultBedroomFilter: text("default_bedroom_filter").notNull(),
  normalStayType: text("normal_stay_type").notNull(),
  fallbackStayType: text("fallback_stay_type").notNull(),
  idealCommuteMinutes: integer("ideal_commute_minutes").notNull(),
  acceptableCommuteMinutes: integer("acceptable_commute_minutes").notNull(),
  longWalkMinutes: integer("long_walk_minutes").notNull(),
  heavyWalkMinutes: integer("heavy_walk_minutes").notNull(),
  panicModeEnabled: integer("panic_mode_enabled", { mode: "boolean" }).notNull(),
  aiOnCaptureEnabled: integer("ai_on_capture_enabled", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const listings = sqliteTable("listings", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull(),
  canonicalSourceUrl: text("canonical_source_url").notNull(),
  title: text("title").notNull(),
  monthlyRent: integer("monthly_rent"),
  knownTotalFees: integer("known_total_fees"),
  stayType: text("stay_type").notNull(),
  bedroomCount: real("bedroom_count"),
  bedroomLabel: text("bedroom_label"),
  bathroomType: text("bathroom_type").notNull(),
  kitchen: text("kitchen").notNull(),
  washer: text("washer").notNull(),
  furnished: text("furnished").notNull(),
  availabilitySummary: text("availability_summary"),
  earliestMoveIn: text("earliest_move_in"),
  latestMoveIn: text("latest_move_in"),
  earliestMoveOut: text("earliest_move_out"),
  latestMoveOut: text("latest_move_out"),
  monthToMonth: integer("month_to_month", { mode: "boolean" }).notNull(),
  status: text("status").notNull(),
  userNotes: text("user_notes"),
  nextAction: text("next_action"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const sourceCaptures = sqliteTable("source_captures", {
  id: text("id").primaryKey(),
  listingId: text("listing_id").references(() => listings.id, { onDelete: "set null" }),
  source: text("source").notNull(),
  url: text("url").notNull(),
  capturedTitle: text("captured_title"),
  capturedText: text("captured_text"),
  selectedText: text("selected_text"),
  visibleFieldsJson: text("visible_fields_json").notNull(),
  thumbnailCandidatesJson: text("thumbnail_candidates_json").notNull(),
  pageHash: text("page_hash"),
  captureMethod: text("capture_method").notNull(),
  capturedAt: text("captured_at").notNull()
});

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  listingId: text("listing_id")
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  address: text("address"),
  crossStreets: text("cross_streets"),
  neighborhood: text("neighborhood"),
  geographyCategory: text("geography_category").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  source: text("source").notNull(),
  confidence: text("confidence").notNull(),
  isUserConfirmed: integer("is_user_confirmed", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const commuteEstimates = sqliteTable("commute_estimates", {
  id: text("id").primaryKey(),
  listingId: text("listing_id")
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  totalMinutes: integer("total_minutes"),
  walkMinutes: integer("walk_minutes"),
  transferCount: integer("transfer_count"),
  routeSummary: text("route_summary"),
  lineNamesJson: text("line_names_json").notNull(),
  hasBusHeavyRoute: integer("has_bus_heavy_route", { mode: "boolean" }).notNull(),
  confidence: text("confidence").notNull(),
  calculatedAt: text("calculated_at").notNull()
});

export const scoreBreakdowns = sqliteTable("score_breakdowns", {
  id: text("id").primaryKey(),
  listingId: text("listing_id")
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  totalScore: integer("total_score").notNull(),
  commuteScore: integer("commute_score").notNull(),
  locationScore: integer("location_score").notNull(),
  priceScore: integer("price_score").notNull(),
  dateScore: integer("date_score").notNull(),
  amenityScore: integer("amenity_score").notNull(),
  stayBedroomScore: integer("stay_bedroom_score").notNull(),
  hardFilterStatus: text("hard_filter_status").notNull(),
  hardFilterReasonsJson: text("hard_filter_reasons_json").notNull(),
  scoreExplanation: text("score_explanation").notNull(),
  cleanupActionsJson: text("cleanup_actions_json").notNull(),
  riskFlagsJson: text("risk_flags_json").notNull(),
  calculatedAt: text("calculated_at").notNull()
});

export const mediaThumbnails = sqliteTable("media_thumbnails", {
  id: text("id").primaryKey(),
  listingId: text("listing_id")
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  cachedPath: text("cached_path"),
  width: integer("width"),
  height: integer("height"),
  createdAt: text("created_at").notNull()
});

export const aiAnalyses = sqliteTable("ai_analyses", {
  id: text("id").primaryKey(),
  listingId: text("listing_id").references(() => listings.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  model: text("model"),
  analysisJson: text("analysis_json").notNull(),
  createdAt: text("created_at").notNull()
});

export const statusEvents = sqliteTable("status_events", {
  id: text("id").primaryKey(),
  listingId: text("listing_id")
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull()
});

export const exportsTable = sqliteTable("exports", {
  id: text("id").primaryKey(),
  format: text("format").notNull(),
  rowCount: integer("row_count").notNull(),
  createdAt: text("created_at").notNull()
});

export const listingRelations = relations(listings, ({ many }) => ({
  captures: many(sourceCaptures),
  locations: many(locations),
  commuteEstimates: many(commuteEstimates),
  scoreBreakdowns: many(scoreBreakdowns),
  mediaThumbnails: many(mediaThumbnails),
  aiAnalyses: many(aiAnalyses),
  statusEvents: many(statusEvents)
}));

export const schema = {
  aiAnalyses,
  commuteEstimates,
  exportsTable,
  listingRelations,
  listings,
  locations,
  mediaThumbnails,
  scoreBreakdowns,
  settings,
  sourceCaptures,
  statusEvents
};

import type {
  BedroomFilter,
  CapturePayload,
  CommuteSummary,
  GeographyCategory,
  ListingDateWindow,
  ListingLocation,
  ListingSource,
  ListingStatus,
  LocationConfidence,
  LocationSource,
  SearchSettings,
  ScoreBreakdown,
  StayType
} from "@pamila/core";

export const DEFAULT_SETTINGS_ID = "default";

export interface SettingsRecord extends SearchSettings {
  id: string;
  officeLat: number | null;
  officeLng: number | null;
  aiOnCaptureEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListingRecord extends ListingDateWindow {
  id: string;
  source: ListingSource;
  sourceUrl: string;
  canonicalSourceUrl: string;
  title: string;
  monthlyRent: number | null;
  knownTotalFees: number | null;
  stayType: StayType;
  bedroomCount: number | null;
  bedroomLabel: string | null;
  bathroomType: "private" | "shared" | "unknown";
  kitchen: "yes" | "no" | "unknown";
  washer: "in_unit" | "in_building" | "nearby" | "no" | "unknown";
  furnished: "yes" | "no" | "unknown";
  status: ListingStatus;
  userNotes: string | null;
  nextAction: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListingWithScore extends ListingRecord {
  scoreBreakdown: StoredScoreBreakdown | null;
}

export type CreateListingInput = Partial<
  Pick<
    ListingRecord,
    | "availabilitySummary"
    | "bathroomType"
    | "bedroomCount"
    | "bedroomLabel"
    | "earliestMoveIn"
    | "earliestMoveOut"
    | "furnished"
    | "kitchen"
    | "knownTotalFees"
    | "latestMoveIn"
    | "latestMoveOut"
    | "monthToMonth"
    | "monthlyRent"
    | "nextAction"
    | "status"
    | "stayType"
    | "title"
    | "userNotes"
    | "washer"
  >
> & {
  source: ListingSource;
  sourceUrl: string;
  canonicalSourceUrl?: string;
};

export type UpdateListingInput = Partial<Omit<CreateListingInput, "source" | "sourceUrl">> &
  Partial<Pick<ListingRecord, "source" | "sourceUrl">>;

export interface CaptureImportInput extends Omit<CapturePayload, "capturedAt"> {
  capturedAt?: string;
  captureMethod?: "extension" | "manual_form" | "manual_paste";
  pageHash?: string | null;
}

export interface CaptureRecord {
  id: string;
  listingId: string | null;
  source: ListingSource;
  url: string;
  capturedTitle: string | null;
  capturedText: string | null;
  selectedText: string | null;
  visibleFields: Record<string, string>;
  thumbnailCandidates: Array<{
    url: string;
    width: number | null;
    height: number | null;
  }>;
  pageHash: string | null;
  captureMethod: "extension" | "manual_form" | "manual_paste";
  capturedAt: string;
}

export interface LocationRecord extends ListingLocation {
  id: string;
  listingId: string;
  createdAt: string;
  updatedAt: string;
}

export type UpsertLocationInput = Partial<
  Pick<LocationRecord, "address" | "crossStreets" | "geographyCategory" | "lat" | "lng" | "neighborhood">
> & {
  label?: string | null;
  source?: LocationSource;
  confidence?: LocationConfidence;
  isUserConfirmed?: boolean;
};

export interface CommuteEstimateRecord extends CommuteSummary {
  id: string;
  listingId: string;
  calculatedAt: string;
}

export type UpsertCommuteEstimateInput = Partial<
  Pick<
    CommuteEstimateRecord,
    "hasBusHeavyRoute" | "lineNames" | "routeSummary" | "totalMinutes" | "transferCount" | "walkMinutes"
  >
> & {
  confidence?: CommuteSummary["confidence"];
  calculatedAt?: string;
};

export interface AiAnalysisRecord {
  id: string;
  listingId: string | null;
  inputHash: string;
  model: string | null;
  analysis: Record<string, unknown>;
  createdAt: string;
}

export interface SaveAiAnalysisInput {
  listingId?: string | null;
  inputHash: string;
  model?: string | null;
  analysis: Record<string, unknown>;
}

export interface StatusEventRecord {
  id: string;
  listingId: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

export interface StoredScoreBreakdown extends ScoreBreakdown {
  id: string;
  listingId: string;
  calculatedAt: string;
}

export interface BackupPayload {
  exportedAt: string;
  settings: SettingsRecord;
  listings: ListingWithScore[];
  captures: CaptureRecord[];
  locations?: LocationRecord[];
  commuteEstimates?: CommuteEstimateRecord[];
  aiAnalyses?: AiAnalysisRecord[];
  statusEvents?: StatusEventRecord[];
}

export interface RestoreBackupResult {
  settingsRestored: boolean;
  listingsRestored: number;
  capturesRestored: number;
  locationsRestored: number;
  commuteEstimatesRestored: number;
  aiAnalysesRestored: number;
  statusEventsRestored: number;
}

export interface ListListingsOptions {
  source?: ListingSource;
  status?: ListingStatus;
}

export interface DatabaseOptions {
  databaseUrl?: string;
  migrate?: boolean;
  seed?: boolean;
}

export interface RawBedroomFilterUpdate {
  defaultBedroomFilter?: BedroomFilter;
}

export const GEOGRAPHY_CATEGORIES = ["manhattan", "lic_astoria", "brooklyn", "other", "unknown"] as const satisfies readonly GeographyCategory[];

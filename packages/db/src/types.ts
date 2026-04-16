import type {
  BedroomFilter,
  CapturePayload,
  ListingDateWindow,
  ListingSource,
  ListingStatus,
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

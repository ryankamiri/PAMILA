import type {
  CapturePayload,
  CommuteSummary,
  HardFilterStatus,
  ListingCore,
  ListingDateWindow,
  ListingLocation,
  ScoreBreakdown,
  SearchSettings
} from "@pamila/core";

export type DashboardView = "daily" | "inbox" | "shortlist" | "detail" | "settings";

export interface DashboardListing extends ListingCore {
  dateWindow: ListingDateWindow;
  location: ListingLocation | null;
  commute: CommuteSummary | null;
  score: ScoreBreakdown;
  nextAction: string;
  userNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListingFilters {
  source: "all" | DashboardListing["source"];
  status: "all" | DashboardListing["status"];
  hardFilterStatus: "all" | HardFilterStatus;
  maxRent: number;
  includeFallback: boolean;
  text: string;
}

export interface ManualListingDraft {
  source: DashboardListing["source"];
  sourceUrl: string;
  title: string;
  monthlyRent: string;
  stayType: DashboardListing["stayType"];
  bedroomLabel: string;
  bedroomCount: string;
  neighborhood: string;
  availabilitySummary: string;
  userNotes: string;
}

export interface DashboardSnapshot {
  settings: SearchSettings;
  listings: DashboardListing[];
}

export interface ListingsCsvExport {
  contentType: "text/csv";
  body: string;
}

export interface ListingsJsonExport {
  settings: SearchSettings;
  listings: DashboardListing[];
  captures: CapturePayload[];
}

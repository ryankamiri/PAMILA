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

export type DashboardView = "daily" | "inbox" | "shortlist" | "detail" | "commute" | "settings";

export interface DashboardSettings extends SearchSettings {
  aiOnCaptureEnabled?: boolean;
  officeLat?: number | null;
  officeLng?: number | null;
}

export type LocationConfidenceLabel =
  | "exact"
  | "cross_street"
  | "neighborhood"
  | "approximate"
  | "unknown";

export type LocationSourceLabel =
  | "user_confirmed"
  | "airbnb_approximate"
  | "leasebreak"
  | "captured_text";

export interface DashboardListing extends ListingCore {
  dateWindow: ListingDateWindow;
  location: ListingLocation | null;
  locationSourceLabel?: LocationSourceLabel | null;
  commute: CommuteSummary | null;
  lastCommuteCheckedAt?: string | null;
  score: ScoreBreakdown;
  nextAction: string;
  userNotes: string;
  createdAt: string;
  updatedAt: string;
  captureReview?: CaptureReview | null;
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

export interface ListingBasicsDraft {
  title: string;
  sourceUrl: string;
  monthlyRent: string;
  stayType: DashboardListing["stayType"];
  bedroomLabel: string;
  bedroomCount: string;
  availabilitySummary: string;
  userNotes: string;
}

export interface ManualLocationDraft {
  address: string;
  crossStreets: string;
  neighborhood: string;
  lat: string;
  lng: string;
  confidenceLabel: LocationConfidenceLabel;
  sourceLabel: LocationSourceLabel;
}

export interface ManualCommuteDraft {
  totalMinutes: string;
  transferCount: string;
  walkMinutes: string;
  lineNames: string;
  routeSummary: string;
  hasBusHeavyRoute: boolean;
  lastCheckedAt: string;
}

export interface CaptureSuggestion {
  id: string;
  label: string;
  field:
    | "monthlyRent"
    | "stayType"
    | "bedroomLabel"
    | "availabilitySummary"
    | "location"
    | "userNotes";
  value: string | number | DashboardListing["stayType"] | ManualLocationDraft;
  source: "heuristic" | "ai" | "captured_field";
  confidence: "high" | "medium" | "low";
  applied?: boolean;
  rejected?: boolean;
}

export interface CaptureReview {
  captureId: string | null;
  source: DashboardListing["source"];
  capturedTitle: string | null;
  pageExcerpt: string | null;
  visibleFields: Record<string, string>;
  suggestions: CaptureSuggestion[];
}

export interface DashboardSnapshot {
  settings: DashboardSettings;
  listings: DashboardListing[];
}

export interface ListingsCsvExport {
  contentType: "text/csv";
  body: string;
}

export interface ListingsJsonExport {
  settings: DashboardSettings;
  listings: DashboardListing[];
  captures: CapturePayload[];
}

export interface GeocodeListingResult {
  status: "ok" | "missing_query" | "geocoder_unavailable" | "no_result";
  location: ListingLocation | null;
  listing: DashboardListing | null;
  warnings: string[];
}

export interface CalculateCommuteResult {
  status: "ok" | "missing_location" | "otp_unavailable" | "otp_error" | "no_route";
  commute: CommuteSummary | null;
  listing: DashboardListing | null;
  warnings: string[];
  externalDirectionsUrl: string | null;
}

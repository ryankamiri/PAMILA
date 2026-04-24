export const LISTING_SOURCES = ["airbnb", "leasebreak"] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];

export const LISTING_STATUSES = [
  "new",
  "needs_cleanup",
  "ready_to_review",
  "shortlisted",
  "contacted",
  "waiting_for_response",
  "rejected_by_user",
  "rejected_by_host",
  "no_longer_available",
  "finalist",
  "chosen"
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const STAY_TYPES = ["entire_apartment", "private_room", "shared_room", "unknown"] as const;
export type StayType = (typeof STAY_TYPES)[number];

export const BEDROOM_FILTERS = [
  "studio_only",
  "studio_or_1br",
  "studio_plus",
  "one_bedroom_only",
  "exactly_two_bedrooms",
  "two_bedrooms_plus",
  "any_entire_place"
] as const;
export type BedroomFilter = (typeof BEDROOM_FILTERS)[number];

export type YesNoUnknown = "yes" | "no" | "unknown";
export type BathroomType = "private" | "shared" | "unknown";
export type WasherValue = "in_unit" | "in_building" | "nearby" | "no" | "unknown";

export type GeographyCategory = "manhattan" | "lic_astoria" | "brooklyn" | "other" | "unknown";

export type LocationSource =
  | "exact_address"
  | "cross_streets"
  | "airbnb_approx_pin"
  | "neighborhood"
  | "manual_guess";

export type LocationConfidence = "exact" | "high" | "medium" | "low";

export type HardFilterStatus = "included" | "excluded" | "fallback_only" | "needs_cleanup";

export type BedroomFilterMatchStatus = "match" | "no_match" | "unknown_plausible" | "unknown_needs_cleanup";

export interface LocalPorts {
  api: number;
  openTripPlanner: number;
  web: number;
}

export interface SearchSettings {
  officeName: string;
  officeAddress: string;
  targetStartPrimary: string;
  targetStartSecondary: string;
  targetEnd: string;
  maxMonthlyRent: number;
  defaultBedroomFilter: BedroomFilter;
  normalStayType: StayType;
  fallbackStayType: StayType;
  idealCommuteMinutes: number;
  acceptableCommuteMinutes: number;
  longWalkMinutes: number;
  heavyWalkMinutes: number;
  panicModeEnabled: boolean;
}

export interface ListingCore {
  id: string;
  source: ListingSource;
  sourceUrl: string;
  title: string;
  monthlyRent: number | null;
  status: ListingStatus;
  stayType: StayType;
  bedroomCount: number | null;
  bedroomLabel: string | null;
  bathroomType: BathroomType;
  kitchen: YesNoUnknown;
  washer: WasherValue;
  furnished: YesNoUnknown;
}

export interface ListingEvaluationInput extends ListingCore {
  dateWindow: ListingDateWindow;
  location: ListingLocation | null;
  commute: CommuteSummary | null;
}

export interface ListingDateWindow {
  availabilitySummary: string | null;
  earliestMoveIn: string | null;
  latestMoveIn: string | null;
  earliestMoveOut: string | null;
  latestMoveOut: string | null;
  monthToMonth: boolean;
}

export interface ListingLocation {
  label: string;
  address: string | null;
  crossStreets: string | null;
  neighborhood: string | null;
  geographyCategory: GeographyCategory;
  lat: number | null;
  lng: number | null;
  source: LocationSource;
  confidence: LocationConfidence;
  isUserConfirmed: boolean;
}

export interface CommuteSummary {
  totalMinutes: number | null;
  walkMinutes: number | null;
  transferCount: number | null;
  routeSummary: string | null;
  lineNames: string[];
  hasBusHeavyRoute: boolean;
  confidence: "exact" | "estimated" | "manual";
}

export type CommuteRouteLegStyle = "walk" | "rail" | "bus" | "ferry" | "other";

export interface CommuteRouteLeg {
  mode: string;
  lineName: string | null;
  routeLongName: string | null;
  fromName: string | null;
  toName: string | null;
  durationMinutes: number | null;
  distanceMeters: number | null;
  geometry: Array<[number, number]>;
  style: CommuteRouteLegStyle;
  color: string;
  dashArray: string | null;
}

export interface CommuteRouteDetail {
  calculatedAt: string;
  originLabel: string | null;
  destinationLabel: string;
  externalDirectionsUrl: string | null;
  legs: CommuteRouteLeg[];
}

export interface ScoreBreakdown {
  totalScore: number;
  commuteScore: number;
  locationScore: number;
  priceScore: number;
  dateScore: number;
  amenityScore: number;
  stayBedroomScore: number;
  hardFilterStatus: HardFilterStatus;
  hardFilterReasons: string[];
  scoreExplanation: string;
  cleanupActions: CleanupAction[];
  riskFlags: RiskFlag[];
}

export interface HardFilterEvaluation {
  status: HardFilterStatus;
  reasons: string[];
  cleanupActions: CleanupAction[];
  riskFlags: RiskFlag[];
}

export interface BedroomFilterMatch {
  status: BedroomFilterMatchStatus;
  reason: string;
  normalizedBedroomCount: number | null;
}

export interface CleanupAction {
  code: string;
  label: string;
  field?: string;
}

export interface RiskFlag {
  code: string;
  label: string;
  severity: "info" | "warning" | "critical";
}

export interface CapturePayload {
  source: ListingSource;
  url: string;
  title: string | null;
  visibleFields: Record<string, string>;
  selectedText: string | null;
  pageText: string | null;
  approxLocation: ListingLocation | null;
  thumbnailCandidates: ThumbnailCandidate[];
  capturedAt: string;
}

export interface ThumbnailCandidate {
  url: string;
  width: number | null;
  height: number | null;
}

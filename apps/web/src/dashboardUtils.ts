import type { CommuteSummary, ListingLocation, ScoreBreakdown } from "@pamila/core";

import type {
  CaptureSuggestion,
  DashboardListing,
  DashboardSnapshot,
  ListingBasicsDraft,
  ListingFilters,
  ManualCommuteDraft,
  ManualListingDraft,
  ManualLocationDraft
} from "./dashboardTypes";

export const formatCurrency = (value: number | null): string => {
  if (value === null) {
    return "Unknown";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
};

export const formatDate = (value: string | null): string => {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`));
};

export const labelize = (value: string): string =>
  value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return "Not checked";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  }).format(new Date(value));
};

export const matchesFilters = (listing: DashboardListing, filters: ListingFilters): boolean => {
  if (!filters.includeFallback && listing.score.hardFilterStatus === "fallback_only") {
    return false;
  }

  if (filters.source !== "all" && listing.source !== filters.source) {
    return false;
  }

  if (filters.status !== "all" && listing.status !== filters.status) {
    return false;
  }

  if (
    filters.hardFilterStatus !== "all" &&
    listing.score.hardFilterStatus !== filters.hardFilterStatus
  ) {
    return false;
  }

  if (listing.monthlyRent !== null && listing.monthlyRent > filters.maxRent) {
    return false;
  }

  const query = filters.text.trim().toLowerCase();
  if (!query) {
    return true;
  }

  const haystack = [
    listing.title,
    listing.source,
    listing.status,
    listing.stayType,
    listing.bedroomLabel,
    listing.location?.neighborhood,
    listing.location?.label,
    listing.nextAction,
    listing.userNotes
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
};

export const applyListingFilters = (
  listings: DashboardListing[],
  filters: ListingFilters
): DashboardListing[] =>
  listings
    .filter((listing) => matchesFilters(listing, filters))
    .sort((a, b) => b.score.totalScore - a.score.totalScore);

export const getDailyQueue = (listings: DashboardListing[]): DashboardListing[] =>
  listings
    .filter((listing) =>
      ["needs_cleanup", "ready_to_review", "new", "waiting_for_response"].includes(listing.status)
    )
    .filter((listing) => listing.score.hardFilterStatus !== "excluded")
    .sort((a, b) => {
      const cleanupDelta = b.score.cleanupActions.length - a.score.cleanupActions.length;
      if (cleanupDelta !== 0) {
        return cleanupDelta;
      }

      return b.score.totalScore - a.score.totalScore;
    })
    .slice(0, 5);

export const getShortlist = (listings: DashboardListing[]): DashboardListing[] =>
  listings
    .filter((listing) => ["shortlisted", "finalist", "ready_to_review"].includes(listing.status))
    .filter((listing) => listing.score.hardFilterStatus === "included")
    .sort((a, b) => b.score.totalScore - a.score.totalScore);

export const listingToBasicsDraft = (listing: DashboardListing): ListingBasicsDraft => ({
  availabilitySummary: listing.dateWindow.availabilitySummary ?? "",
  bedroomCount: listing.bedroomCount === null ? "" : String(listing.bedroomCount),
  bedroomLabel: listing.bedroomLabel ?? "",
  monthlyRent: listing.monthlyRent === null ? "" : String(listing.monthlyRent),
  sourceUrl: listing.sourceUrl,
  stayType: listing.stayType,
  title: listing.title,
  userNotes: listing.userNotes
});

export const basicsDraftToListingPatch = (
  draft: ListingBasicsDraft
): Partial<DashboardListing> => ({
  bedroomCount: parseNullableNumber(draft.bedroomCount),
  bedroomLabel: blankToNull(draft.bedroomLabel),
  dateWindow: {
    availabilitySummary: blankToNull(draft.availabilitySummary),
    earliestMoveIn: null,
    earliestMoveOut: null,
    latestMoveIn: null,
    latestMoveOut: null,
    monthToMonth: false
  },
  monthlyRent: parseNullableNumber(draft.monthlyRent),
  sourceUrl: draft.sourceUrl.trim(),
  stayType: draft.stayType,
  title: draft.title.trim() || "Untitled listing",
  userNotes: draft.userNotes.trim()
});

export const listingToLocationDraft = (listing: DashboardListing): ManualLocationDraft => ({
  address: listing.location?.address ?? "",
  confidenceLabel: listing.location
    ? confidenceLabelFromLocation(listing.location)
    : "unknown",
  crossStreets: listing.location?.crossStreets ?? "",
  lat: listing.location?.lat === null || listing.location?.lat === undefined ? "" : String(listing.location.lat),
  lng: listing.location?.lng === null || listing.location?.lng === undefined ? "" : String(listing.location.lng),
  neighborhood: listing.location?.neighborhood ?? "",
  sourceLabel: listing.locationSourceLabel ?? sourceLabelFromLocation(listing.location, listing.source)
});

export const locationDraftToLocation = (
  draft: ManualLocationDraft
): ListingLocation | null => {
  const address = draft.address.trim();
  const crossStreets = draft.crossStreets.trim();
  const neighborhood = draft.neighborhood.trim();
  const lat = parseCoordinateDraft(draft.lat);
  const lng = parseCoordinateDraft(draft.lng);
  const label = address || crossStreets || neighborhood;

  if (!label && lat === null && lng === null && draft.confidenceLabel === "unknown") {
    return null;
  }

  return {
    address: address || null,
    confidence: coreConfidenceFromLabel(draft.confidenceLabel),
    crossStreets: crossStreets || null,
    geographyCategory: geographyFromText(`${address} ${crossStreets} ${neighborhood}`),
    isUserConfirmed: draft.sourceLabel === "user_confirmed",
    label: label || "Unknown location",
    lat,
    lng,
    neighborhood: neighborhood || null,
    source: coreSourceFromLabels(draft.sourceLabel, draft.confidenceLabel)
  };
};

export const listingToCommuteDraft = (listing: DashboardListing): ManualCommuteDraft => ({
  hasBusHeavyRoute: listing.commute?.hasBusHeavyRoute ?? false,
  lastCheckedAt: listing.lastCommuteCheckedAt ?? "",
  lineNames: listing.commute?.lineNames.join(", ") ?? "",
  routeSummary: listing.commute?.routeSummary ?? "",
  totalMinutes: listing.commute?.totalMinutes === null || listing.commute?.totalMinutes === undefined
    ? ""
    : String(listing.commute.totalMinutes),
  transferCount:
    listing.commute?.transferCount === null || listing.commute?.transferCount === undefined
      ? ""
      : String(listing.commute.transferCount),
  walkMinutes:
    listing.commute?.walkMinutes === null || listing.commute?.walkMinutes === undefined
      ? ""
      : String(listing.commute.walkMinutes)
});

export const commuteDraftToSummary = (draft: ManualCommuteDraft): CommuteSummary | null => {
  const totalMinutes = parseNullableNumber(draft.totalMinutes);
  const walkMinutes = parseNullableNumber(draft.walkMinutes);
  const transferCount = parseNullableNumber(draft.transferCount);
  const lineNames = draft.lineNames
    .split(",")
    .map((line) => line.trim())
    .filter(Boolean);

  if (
    totalMinutes === null &&
    walkMinutes === null &&
    transferCount === null &&
    !draft.routeSummary.trim() &&
    lineNames.length === 0
  ) {
    return null;
  }

  return {
    confidence: "manual",
    hasBusHeavyRoute: draft.hasBusHeavyRoute,
    lineNames,
    routeSummary: draft.routeSummary.trim() || null,
    totalMinutes,
    transferCount,
    walkMinutes
  };
};

export const getMissingFinalistBlockers = (listing: DashboardListing): string[] => {
  const blockers: string[] = [];

  if (listing.monthlyRent === null) {
    blockers.push("price");
  }

  if (
    !listing.dateWindow.availabilitySummary &&
    !listing.dateWindow.earliestMoveIn &&
    !listing.dateWindow.latestMoveOut
  ) {
    blockers.push("dates");
  }

  if (listing.stayType === "unknown") {
    blockers.push("stay type");
  }

  if (!listing.location) {
    blockers.push("location");
  }

  return blockers;
};

export const applyCaptureSuggestionToListing = (
  listing: DashboardListing,
  suggestion: CaptureSuggestion
): DashboardListing => {
  const now = new Date().toISOString();

  switch (suggestion.field) {
    case "monthlyRent":
      return {
        ...listing,
        monthlyRent: typeof suggestion.value === "number" ? suggestion.value : parseNullableNumber(String(suggestion.value)),
        updatedAt: now
      };
    case "stayType":
      return {
        ...listing,
        stayType: suggestion.value as DashboardListing["stayType"],
        updatedAt: now
      };
    case "bedroomLabel":
      return {
        ...listing,
        bedroomLabel: String(suggestion.value),
        updatedAt: now
      };
    case "availabilitySummary":
      return {
        ...listing,
        dateWindow: {
          ...listing.dateWindow,
          availabilitySummary: String(suggestion.value)
        },
        updatedAt: now
      };
    case "location": {
      const location = locationDraftToLocation(suggestion.value as ManualLocationDraft);
      return {
        ...listing,
        location,
        locationSourceLabel: (suggestion.value as ManualLocationDraft).sourceLabel,
        updatedAt: now
      };
    }
    case "userNotes":
      return {
        ...listing,
        updatedAt: now,
        userNotes: [listing.userNotes, String(suggestion.value)].filter(Boolean).join("\n")
      };
  }
};

export const markCaptureSuggestion = (
  listing: DashboardListing,
  suggestionId: string,
  result: "applied" | "rejected"
): DashboardListing => {
  if (!listing.captureReview) {
    return listing;
  }

  return {
    ...listing,
    captureReview: {
      ...listing.captureReview,
      suggestions: listing.captureReview.suggestions.map((suggestion) =>
        suggestion.id === suggestionId
          ? {
              ...suggestion,
              applied: result === "applied",
              rejected: result === "rejected"
            }
          : suggestion
      )
    }
  };
};

export const createLocalCsvExport = (listings: DashboardListing[]): string => {
  const headers = [
    "id",
    "source",
    "title",
    "sourceUrl",
    "monthlyRent",
    "stayType",
    "bedroom",
    "status",
    "totalScore",
    "hardFilterStatus",
    "location",
    "commuteMinutes",
    "nextAction"
  ];

  const rows = listings.map((listing) => [
    listing.id,
    listing.source,
    listing.title,
    listing.sourceUrl,
    listing.monthlyRent ?? "",
    listing.stayType,
    listing.bedroomLabel ?? "",
    listing.status,
    listing.score.totalScore,
    listing.score.hardFilterStatus,
    listing.location?.label ?? "",
    listing.commute?.totalMinutes ?? "",
    listing.nextAction
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
};

export const createLocalBackupExport = (snapshot: DashboardSnapshot): string =>
  JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      ...snapshot
    },
    null,
    2
  );

const pendingScore = (reason: string): ScoreBreakdown => ({
  amenityScore: 0,
  cleanupActions: [
    {
      code: "score_pending",
      field: "score",
      label: "Run backend scoring once the API is connected"
    }
  ],
  commuteScore: 0,
  dateScore: 0,
  hardFilterReasons: [reason],
  hardFilterStatus: "needs_cleanup",
  locationScore: 0,
  priceScore: 0,
  riskFlags: [
    {
      code: "manual_entry_unscored",
      label: reason,
      severity: "info"
    }
  ],
  scoreExplanation: reason,
  stayBedroomScore: 0,
  totalScore: 0
});

export const createManualListing = (
  draft: ManualListingDraft,
  existingCount: number
): DashboardListing => {
  const now = new Date().toISOString();
  const parsedRent = Number.parseInt(draft.monthlyRent.replace(/[^\d]/g, ""), 10);
  const parsedBedroomCount =
    draft.bedroomCount.trim() === "" ? null : Number.parseFloat(draft.bedroomCount);

  return {
    bathroomType: "unknown",
    bedroomCount: Number.isNaN(parsedBedroomCount) ? null : parsedBedroomCount,
    bedroomLabel: draft.bedroomLabel.trim() || null,
    commute: null,
    createdAt: now,
    dateWindow: {
      availabilitySummary: draft.availabilitySummary.trim() || null,
      earliestMoveIn: null,
      earliestMoveOut: null,
      latestMoveIn: null,
      latestMoveOut: null,
      monthToMonth: false
    },
    furnished: "unknown",
    id: `manual-${Date.now()}-${existingCount + 1}`,
    kitchen: "unknown",
    location: draft.neighborhood.trim()
      ? {
          address: null,
          confidence: "low",
          crossStreets: null,
          geographyCategory: "unknown",
          isUserConfirmed: false,
          label: draft.neighborhood.trim(),
          lat: null,
          lng: null,
          neighborhood: draft.neighborhood.trim(),
          source: "manual_guess"
        }
      : null,
    monthlyRent: Number.isNaN(parsedRent) ? null : parsedRent,
    nextAction: "Clean up required fields, then recalculate score through the API.",
    score: pendingScore("Manual listing needs backend scoring and field cleanup."),
    source: draft.source,
    sourceUrl: draft.sourceUrl.trim(),
    status: "needs_cleanup",
    stayType: draft.stayType,
    title: draft.title.trim() || "Untitled listing",
    updatedAt: now,
    userNotes: draft.userNotes.trim(),
    washer: "unknown"
  };
};

function parseNullableNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinateDraft(value: string): number | null {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function coreConfidenceFromLabel(label: ManualLocationDraft["confidenceLabel"]) {
  switch (label) {
    case "exact":
      return "exact";
    case "cross_street":
      return "high";
    case "neighborhood":
      return "medium";
    case "approximate":
      return "medium";
    case "unknown":
      return "low";
  }
}

function confidenceLabelFromLocation(location: ListingLocation): ManualLocationDraft["confidenceLabel"] {
  if (location.confidence === "exact") {
    return "exact";
  }

  if (location.source === "cross_streets") {
    return "cross_street";
  }

  if (location.source === "airbnb_approx_pin") {
    return "approximate";
  }

  if (location.source === "neighborhood") {
    return "neighborhood";
  }

  return location.confidence === "low" ? "unknown" : "neighborhood";
}

function sourceLabelFromLocation(
  location: ListingLocation | null,
  listingSource: DashboardListing["source"]
): ManualLocationDraft["sourceLabel"] {
  if (!location) {
    return "captured_text";
  }

  if (location.source === "airbnb_approx_pin") {
    return "airbnb_approximate";
  }

  if (location.isUserConfirmed || location.source === "exact_address" || location.source === "cross_streets") {
    return "user_confirmed";
  }

  return listingSource === "leasebreak" ? "leasebreak" : "captured_text";
}

function coreSourceFromLabels(
  sourceLabel: ManualLocationDraft["sourceLabel"],
  confidenceLabel: ManualLocationDraft["confidenceLabel"]
): ListingLocation["source"] {
  if (sourceLabel === "airbnb_approximate") {
    return "airbnb_approx_pin";
  }

  if (confidenceLabel === "exact") {
    return "exact_address";
  }

  if (confidenceLabel === "cross_street") {
    return "cross_streets";
  }

  if (confidenceLabel === "neighborhood") {
    return "neighborhood";
  }

  return "manual_guess";
}

function geographyFromText(value: string): ListingLocation["geographyCategory"] {
  const text = value.toLowerCase();

  if (/(chelsea|nomad|village|soho|tribeca|harlem|uws|ues|manhattan|midtown|flatiron|gramercy)/.test(text)) {
    return "manhattan";
  }

  if (/(lic|long island city|astoria|court sq|court square)/.test(text)) {
    return "lic_astoria";
  }

  if (/(brooklyn|greenpoint|williamsburg|fort greene|downtown brooklyn|bed-stuy)/.test(text)) {
    return "brooklyn";
  }

  return "unknown";
}

function csvCell(value: unknown) {
  const stringValue = String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

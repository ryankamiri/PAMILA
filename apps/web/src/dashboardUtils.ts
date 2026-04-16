import type { ScoreBreakdown } from "@pamila/core";

import type { DashboardListing, ListingFilters, ManualListingDraft } from "./dashboardTypes";

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

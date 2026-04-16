import {
  DEFAULT_SEARCH_SETTINGS,
  type CleanupAction,
  type CommuteSummary,
  type ListingLocation,
  type RiskFlag,
  type ScoreBreakdown
} from "@pamila/core";

import type { DashboardListing, ManualListingDraft } from "./dashboardTypes";

const action = (code: string, label: string, field?: string): CleanupAction => ({
  code,
  label,
  ...(field ? { field } : {})
});

const risk = (code: string, label: string, severity: RiskFlag["severity"]): RiskFlag => ({
  code,
  label,
  severity
});

const score = (
  totalScore: number,
  hardFilterStatus: ScoreBreakdown["hardFilterStatus"],
  scoreExplanation: string,
  cleanupActions: CleanupAction[] = [],
  riskFlags: RiskFlag[] = []
): ScoreBreakdown => ({
  amenityScore: Math.min(10, Math.max(0, Math.round(totalScore * 0.1))),
  cleanupActions,
  commuteScore: Math.min(35, Math.max(0, Math.round(totalScore * 0.35))),
  dateScore: Math.min(15, Math.max(0, Math.round(totalScore * 0.15))),
  hardFilterReasons:
    hardFilterStatus === "included" ? [] : riskFlags.map((flag) => flag.label),
  hardFilterStatus,
  locationScore: Math.min(20, Math.max(0, Math.round(totalScore * 0.2))),
  priceScore: Math.min(15, Math.max(0, Math.round(totalScore * 0.15))),
  riskFlags,
  scoreExplanation,
  stayBedroomScore: Math.min(5, Math.max(0, Math.round(totalScore * 0.05))),
  totalScore
});

const location = (
  label: string,
  neighborhood: string,
  geographyCategory: ListingLocation["geographyCategory"],
  confidence: ListingLocation["confidence"],
  source: ListingLocation["source"],
  isUserConfirmed = false
): ListingLocation => ({
  address: isUserConfirmed ? label : null,
  confidence,
  crossStreets: isUserConfirmed ? null : label,
  geographyCategory,
  isUserConfirmed,
  label,
  lat: null,
  lng: null,
  neighborhood,
  source
});

const commute = (
  totalMinutes: number | null,
  walkMinutes: number | null,
  transferCount: number | null,
  routeSummary: string | null,
  lineNames: string[],
  hasBusHeavyRoute = false
): CommuteSummary => ({
  confidence: totalMinutes === null ? "manual" : "estimated",
  hasBusHeavyRoute,
  lineNames,
  routeSummary,
  totalMinutes,
  transferCount,
  walkMinutes
});

export const mockDashboardListings: DashboardListing[] = [
  {
    bathroomType: "private",
    bedroomCount: 0,
    bedroomLabel: "Studio",
    commute: commute(18, 5, 0, "N/R/W to 23 St", ["N", "R", "W"]),
    createdAt: "2026-04-15T14:00:00.000Z",
    dateWindow: {
      availabilitySummary: "Available Jun 30 through Sep 14",
      earliestMoveIn: "2026-06-30",
      earliestMoveOut: "2026-09-12",
      latestMoveIn: "2026-07-01",
      latestMoveOut: "2026-09-14",
      monthToMonth: false
    },
    furnished: "yes",
    id: "listing-chelsea-studio",
    kitchen: "yes",
    location: location("W 21st St and 8th Ave", "Chelsea", "manhattan", "high", "cross_streets"),
    monthlyRent: 3450,
    nextAction: "Message host to confirm July 1 move-in and washer details.",
    score: score(
      91,
      "included",
      "Excellent commute, full date coverage, Manhattan location, and under the hard rent cap.",
      [action("confirm_washer", "Confirm washer access", "washer")]
    ),
    source: "leasebreak",
    sourceUrl: "https://www.leasebreak.com/example-chelsea-studio",
    status: "ready_to_review",
    stayType: "entire_apartment",
    title: "Bright Chelsea studio near multiple trains",
    updatedAt: "2026-04-15T14:00:00.000Z",
    userNotes: "Looks like the cleanest commute so far.",
    washer: "unknown"
  },
  {
    bathroomType: "private",
    bedroomCount: 1,
    bedroomLabel: "1 bedroom",
    commute: commute(26, 7, 1, "7 to N/R/W", ["7", "N", "R", "W"]),
    createdAt: "2026-04-15T15:30:00.000Z",
    dateWindow: {
      availabilitySummary: "Month to month from July",
      earliestMoveIn: "2026-07-01",
      earliestMoveOut: null,
      latestMoveIn: null,
      latestMoveOut: null,
      monthToMonth: true
    },
    furnished: "yes",
    id: "listing-lic-1br",
    kitchen: "yes",
    location: location("Court Sq", "Long Island City", "lic_astoria", "medium", "airbnb_approx_pin"),
    monthlyRent: 3320,
    nextAction: "Ask whether the stay can be held through September 12.",
    score: score(
      78,
      "included",
      "Good price and workable commute, but the month-to-month end date needs confirmation.",
      [action("confirm_end_date", "Confirm September 12 coverage", "latestMoveOut")],
      [risk("month_to_month", "Month-to-month dates are uncertain", "warning")]
    ),
    source: "airbnb",
    sourceUrl: "https://www.airbnb.com/rooms/10000000000000001",
    status: "needs_cleanup",
    stayType: "entire_apartment",
    title: "LIC furnished 1BR with skyline view",
    updatedAt: "2026-04-15T15:30:00.000Z",
    userNotes: "Airbnb pin is approximate.",
    washer: "in_building"
  },
  {
    bathroomType: "shared",
    bedroomCount: 1,
    bedroomLabel: "Private bedroom",
    commute: commute(21, 4, 0, "L to 6/N/R/W walk transfer", ["L", "6", "N"]),
    createdAt: "2026-04-14T20:10:00.000Z",
    dateWindow: {
      availabilitySummary: "Available July 1 to September 12",
      earliestMoveIn: "2026-07-01",
      earliestMoveOut: "2026-09-12",
      latestMoveIn: "2026-07-01",
      latestMoveOut: "2026-09-12",
      monthToMonth: false
    },
    furnished: "yes",
    id: "listing-ev-private-room",
    kitchen: "yes",
    location: location("E 7th St", "East Village", "manhattan", "medium", "airbnb_approx_pin"),
    monthlyRent: 2400,
    nextAction: "Keep hidden unless Panic Mode is enabled.",
    score: score(
      69,
      "fallback_only",
      "Affordable and convenient, but it is a private room and belongs in fallback mode.",
      [],
      [risk("private_room", "Private room is fallback-only", "warning")]
    ),
    source: "airbnb",
    sourceUrl: "https://www.airbnb.com/rooms/10000000000000002",
    status: "new",
    stayType: "private_room",
    title: "East Village private room close to trains",
    updatedAt: "2026-04-14T20:10:00.000Z",
    userNotes: "",
    washer: "nearby"
  },
  {
    bathroomType: "private",
    bedroomCount: 1,
    bedroomLabel: "1 bedroom",
    commute: commute(19, 3, 0, "Walk or R/W from 28 St", ["R", "W"]),
    createdAt: "2026-04-13T17:45:00.000Z",
    dateWindow: {
      availabilitySummary: "Immediate move-in preferred, latest move-in July 3",
      earliestMoveIn: "2026-05-15",
      earliestMoveOut: "2026-08-31",
      latestMoveIn: "2026-07-03",
      latestMoveOut: "2026-09-12",
      monthToMonth: false
    },
    furnished: "unknown",
    id: "listing-nomad-1br",
    kitchen: "yes",
    location: location("W 29th St and Broadway", "NoMad", "manhattan", "high", "cross_streets"),
    monthlyRent: 3580,
    nextAction: "Ask landlord whether a July 1 start is realistic despite immediate move-in preference.",
    score: score(
      74,
      "needs_cleanup",
      "Great location and commute, but Leasebreak date windows suggest a possible July 1 rejection risk.",
      [
        action("confirm_move_in_flexibility", "Confirm July 1 move-in flexibility", "latestMoveIn"),
        action("confirm_furnished", "Confirm furnished status", "furnished")
      ],
      [risk("early_move_in_pressure", "Earliest move-in is much earlier than target", "warning")]
    ),
    source: "leasebreak",
    sourceUrl: "https://www.leasebreak.com/example-nomad-1br",
    status: "needs_cleanup",
    stayType: "entire_apartment",
    title: "NoMad 1BR with immediate move-in preference",
    updatedAt: "2026-04-13T17:45:00.000Z",
    userNotes: "Could be elite if landlord accepts July 1.",
    washer: "in_building"
  },
  {
    bathroomType: "private",
    bedroomCount: 1,
    bedroomLabel: "1 bedroom",
    commute: commute(34, 16, 1, "Bus to subway, then Q", ["B62", "Q"], true),
    createdAt: "2026-04-12T10:20:00.000Z",
    dateWindow: {
      availabilitySummary: "Available June 30 through September 12",
      earliestMoveIn: "2026-06-30",
      earliestMoveOut: "2026-09-12",
      latestMoveIn: "2026-07-01",
      latestMoveOut: "2026-09-12",
      monthToMonth: false
    },
    furnished: "yes",
    id: "listing-brooklyn-overcap",
    kitchen: "yes",
    location: location("Greenpoint Ave", "Greenpoint", "brooklyn", "medium", "neighborhood"),
    monthlyRent: 3825,
    nextAction: "Reject unless the advertised monthly rent drops under $3,600.",
    score: score(
      42,
      "excluded",
      "Over the hard rent cap and has a long walk or bus-heavy commute.",
      [],
      [
        risk("over_budget", "Advertised rent is over $3,600", "critical"),
        risk("long_walk", "Walk to transit is over 15 minutes", "warning"),
        risk("bus_heavy", "Route depends heavily on bus service", "warning")
      ]
    ),
    source: "leasebreak",
    sourceUrl: "https://www.leasebreak.com/example-greenpoint-1br",
    status: "rejected_by_user",
    stayType: "entire_apartment",
    title: "Greenpoint 1BR with outdoor space",
    updatedAt: "2026-04-12T10:20:00.000Z",
    userNotes: "",
    washer: "in_unit"
  }
];

export const initialDashboardSnapshot = {
  listings: mockDashboardListings,
  settings: DEFAULT_SEARCH_SETTINGS
};

export const emptyManualListingDraft: ManualListingDraft = {
  availabilitySummary: "",
  bedroomCount: "",
  bedroomLabel: "",
  monthlyRent: "",
  neighborhood: "",
  source: "leasebreak",
  sourceUrl: "",
  stayType: "entire_apartment",
  title: "",
  userNotes: ""
};

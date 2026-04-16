import { describe, expect, it } from "vitest";

import { DEFAULT_SEARCH_SETTINGS } from "./defaults.js";
import {
  calculatePamilaScore,
  canonicalizeListingUrl,
  evaluateHardFilters,
  generateCleanupActions,
  getListingDuplicateKey,
  isAirbnbApproximateLocation,
  isFallbackOnly,
  matchBedroomFilter
} from "./logic.js";
import type { CommuteSummary, ListingEvaluationInput, SearchSettings } from "./types.js";

const subwayCommute = (overrides: Partial<CommuteSummary> = {}): CommuteSummary => ({
  confidence: "estimated",
  hasBusHeavyRoute: false,
  lineNames: ["N", "R", "W"],
  routeSummary: "Subway",
  totalMinutes: 18,
  transferCount: 0,
  walkMinutes: 5,
  ...overrides
});

const baseListing = (overrides: Partial<ListingEvaluationInput> = {}): ListingEvaluationInput => ({
  bathroomType: "private",
  bedroomCount: 1,
  bedroomLabel: "1 bedroom",
  commute: subwayCommute(),
  dateWindow: {
    availabilitySummary: "Available July 1 through September 12",
    earliestMoveIn: "2026-07-01",
    earliestMoveOut: null,
    latestMoveIn: "2026-07-01",
    latestMoveOut: "2026-09-12",
    monthToMonth: false
  },
  furnished: "yes",
  id: "listing-1",
  kitchen: "yes",
  location: {
    address: "100 W 20th St, New York, NY",
    confidence: "exact",
    crossStreets: null,
    geographyCategory: "manhattan",
    isUserConfirmed: true,
    label: "Chelsea",
    lat: 40.742,
    lng: -73.994,
    neighborhood: "Chelsea",
    source: "exact_address"
  },
  monthlyRent: 3450,
  source: "leasebreak",
  sourceUrl: "https://www.leasebreak.com/short-term-rental-details/123",
  status: "new",
  stayType: "entire_apartment",
  title: "Chelsea 1BR",
  washer: "in_building",
  ...overrides
});

describe("bedroom filter matching", () => {
  it("supports exact and flexible bedroom filters", () => {
    expect(matchBedroomFilter({ bedroomCount: 0, bedroomLabel: "Studio" }, "studio_only").status).toBe("match");
    expect(matchBedroomFilter({ bedroomCount: 2, bedroomLabel: "2 bedroom" }, "exactly_two_bedrooms").status).toBe("match");
    expect(matchBedroomFilter({ bedroomCount: 2, bedroomLabel: "2 bedroom" }, "studio_or_1br").status).toBe("no_match");
  });

  it("marks unknown bedrooms as cleanup for exact searches", () => {
    expect(matchBedroomFilter({ bedroomCount: null, bedroomLabel: null }, "exactly_two_bedrooms").status).toBe("unknown_needs_cleanup");
    expect(matchBedroomFilter({ bedroomCount: null, bedroomLabel: null }, "studio_or_1br").status).toBe("unknown_plausible");
  });
});

describe("hard filters and PAMILA score", () => {
  it("ranks an ideal Manhattan apartment near the top", () => {
    const listing = baseListing();
    const hardFilters = evaluateHardFilters(listing);
    const score = calculatePamilaScore(listing);

    expect(hardFilters.status).toBe("included");
    expect(score.totalScore).toBe(94);
    expect(score.commuteScore).toBe(35);
    expect(score.locationScore).toBe(20);
    expect(score.dateScore).toBe(15);
    expect(score.scoreExplanation).toContain("18 minutes");
  });

  it("keeps a Leasebreak immediate move-in listing eligible with date risk", () => {
    const listing = baseListing({
      dateWindow: {
        availabilitySummary: "Immediate move-in preferred, latest move-in July 5",
        earliestMoveIn: "2026-04-15",
        earliestMoveOut: null,
        latestMoveIn: "2026-07-05",
        latestMoveOut: "2026-09-30",
        monthToMonth: false
      }
    });
    const score = calculatePamilaScore(listing);

    expect(score.hardFilterStatus).toBe("included");
    expect(score.dateScore).toBe(8);
    expect(score.riskFlags.map((flag) => flag.code)).toContain("leasebreak_immediate_move_in_risk");
    expect(score.cleanupActions.map((action) => action.code)).toContain("ask_july_start_ok");
  });

  it("hard-excludes over-budget listings even with a perfect commute", () => {
    const score = calculatePamilaScore(baseListing({ monthlyRent: 3750 }));

    expect(score.hardFilterStatus).toBe("excluded");
    expect(score.totalScore).toBe(0);
    expect(score.hardFilterReasons.join(" ")).toContain("above the $3600 hard cap");
  });

  it("keeps private rooms fallback-only until Panic/Fallback Mode", () => {
    const listing = baseListing({
      monthlyRent: 2400,
      source: "airbnb",
      stayType: "private_room"
    });
    const normalScore = calculatePamilaScore(listing);
    const panicSettings: SearchSettings = {
      ...DEFAULT_SEARCH_SETTINGS,
      panicModeEnabled: true
    };
    const panicScore = calculatePamilaScore(listing, panicSettings);

    expect(normalScore.hardFilterStatus).toBe("fallback_only");
    expect(isFallbackOnly(listing)).toBe(true);
    expect(panicScore.hardFilterStatus).toBe("included");
    expect(isFallbackOnly(listing, panicSettings)).toBe(true);
  });

  it("prefers an easy subway route over a faster bus-heavy long-walk route", () => {
    const easySubway = calculatePamilaScore(baseListing({ commute: subwayCommute({ totalMinutes: 22, walkMinutes: 6 }) }));
    const busHeavy = calculatePamilaScore(
      baseListing({
        commute: subwayCommute({
          hasBusHeavyRoute: true,
          lineNames: ["M14"],
          routeSummary: "Bus main leg",
          totalMinutes: 19,
          walkMinutes: 13
        })
      })
    );

    expect(easySubway.commuteScore).toBeGreaterThan(busHeavy.commuteScore);
    expect(busHeavy.riskFlags.map((flag) => flag.code)).toContain("long_walk_to_transit");
    expect(busHeavy.riskFlags.map((flag) => flag.code)).toContain("bus_heavy_route");
  });

  it("allows a strong Brooklyn listing to beat a weak Manhattan listing", () => {
    const brooklyn = calculatePamilaScore(
      baseListing({
        commute: subwayCommute({ totalMinutes: 24 }),
        location: {
          ...baseListing().location!,
          geographyCategory: "brooklyn",
          label: "Downtown Brooklyn",
          neighborhood: "Downtown Brooklyn"
        },
        monthlyRent: 3000
      })
    );
    const manhattan = calculatePamilaScore(
      baseListing({
        commute: subwayCommute({ totalMinutes: 34, transferCount: 1, walkMinutes: 12 }),
        dateWindow: {
          availabilitySummary: null,
          earliestMoveIn: null,
          earliestMoveOut: null,
          latestMoveIn: null,
          latestMoveOut: null,
          monthToMonth: false
        },
        monthlyRent: 3600
      })
    );

    expect(brooklyn.totalScore).toBeGreaterThan(manhattan.totalScore);
    expect(brooklyn.locationScore).toBe(8);
    expect(manhattan.hardFilterStatus).toBe("needs_cleanup");
  });

  it("creates cleanup actions for unknowns while using provisional amenity credit", () => {
    const score = calculatePamilaScore(
      baseListing({
        furnished: "unknown",
        kitchen: "unknown",
        washer: "unknown"
      })
    );

    expect(score.amenityScore).toBe(10);
    expect(generateCleanupActions(baseListing({ kitchen: "unknown" })).map((action) => action.code)).toContain("confirm_kitchen");
  });
});

describe("source-specific helpers", () => {
  it("accepts Airbnb approximate pins without a location score penalty", () => {
    const listing = baseListing({
      location: {
        ...baseListing().location!,
        confidence: "medium",
        isUserConfirmed: false,
        source: "airbnb_approx_pin"
      },
      source: "airbnb"
    });
    const score = calculatePamilaScore(listing);

    expect(isAirbnbApproximateLocation(listing)).toBe(true);
    expect(score.locationScore).toBe(20);
    expect(score.riskFlags.map((flag) => flag.code)).toContain("airbnb_approx_location");
  });

  it("canonicalizes source URLs for duplicate detection", () => {
    expect(canonicalizeListingUrl("https://www.airbnb.com/rooms/12345?source_impression_id=abc#photos")).toBe(
      "https://www.airbnb.com/rooms/12345"
    );
    expect(canonicalizeListingUrl("https://www.leasebreak.com/short-term-rental-details/123/?foo=bar")).toBe(
      "https://www.leasebreak.com/short-term-rental-details/123"
    );
    expect(getListingDuplicateKey("airbnb", "https://airbnb.com/rooms/12345?check_in=2026-07-01")).toBe(
      "airbnb:https://www.airbnb.com/rooms/12345"
    );
  });
});

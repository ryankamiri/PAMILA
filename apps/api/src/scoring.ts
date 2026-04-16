import {
  calculatePamilaScore,
  type ListingEvaluationInput,
  type ScoreBreakdown,
  type SearchSettings
} from "@pamila/core";
import type { CommuteEstimateRecord, ListingRecord, LocationRecord } from "@pamila/db";

export function calculateListingScore(
  listing: ListingRecord,
  settings: SearchSettings,
  context: { commute?: CommuteEstimateRecord | null; location?: LocationRecord | null } = {}
): ScoreBreakdown {
  return calculatePamilaScore(toListingEvaluationInput(listing, context), settings);
}

function toListingEvaluationInput(
  listing: ListingRecord,
  context: { commute?: CommuteEstimateRecord | null; location?: LocationRecord | null }
): ListingEvaluationInput {
  return {
    bathroomType: listing.bathroomType,
    bedroomCount: listing.bedroomCount,
    bedroomLabel: listing.bedroomLabel,
    commute: context.commute ?? null,
    dateWindow: {
      availabilitySummary: listing.availabilitySummary,
      earliestMoveIn: listing.earliestMoveIn,
      earliestMoveOut: listing.earliestMoveOut,
      latestMoveIn: listing.latestMoveIn,
      latestMoveOut: listing.latestMoveOut,
      monthToMonth: listing.monthToMonth
    },
    furnished: listing.furnished,
    id: listing.id,
    kitchen: listing.kitchen,
    location: context.location ?? null,
    monthlyRent: listing.monthlyRent,
    source: listing.source,
    sourceUrl: listing.sourceUrl,
    status: listing.status,
    stayType: listing.stayType,
    title: listing.title,
    washer: listing.washer
  };
}

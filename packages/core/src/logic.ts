import { DEFAULT_SEARCH_SETTINGS } from "./defaults.js";
import type {
  BedroomFilter,
  BedroomFilterMatch,
  CleanupAction,
  CommuteSummary,
  HardFilterEvaluation,
  ListingDateWindow,
  ListingEvaluationInput,
  ListingLocation,
  ListingSource,
  RiskFlag,
  ScoreBreakdown,
  SearchSettings
} from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface DateFitEvaluation {
  score: number;
  hardExcluded: boolean;
  needsCleanup: boolean;
  reasons: string[];
  cleanupActions: CleanupAction[];
  riskFlags: RiskFlag[];
}

function cleanupAction(code: string, label: string, field?: string): CleanupAction {
  return field === undefined ? { code, label } : { code, label, field };
}

function riskFlag(code: string, label: string, severity: RiskFlag["severity"]): RiskFlag {
  return { code, label, severity };
}

function uniqueByCode<T extends { code: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (!seen.has(item.code)) {
      seen.add(item.code);
      result.push(item);
    }
  }

  return result;
}

function parseIsoDate(value: string | null): Date | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function compareDates(left: Date, right: Date): number {
  return Math.round((left.getTime() - right.getTime()) / MS_PER_DAY);
}

function isSameDate(left: Date | null, right: Date): boolean {
  return left !== null && compareDates(left, right) === 0;
}

function lower(value: string | null): string {
  return value?.toLowerCase() ?? "";
}

function hasImmediateMoveInSignal(dateWindow: ListingDateWindow): boolean {
  const summary = lower(dateWindow.availabilitySummary);
  return /\b(immediate|available now|asap|right away)\b/.test(summary);
}

function normalizeBedroomCount(bedroomCount: number | null, bedroomLabel: string | null): number | null {
  if (typeof bedroomCount === "number" && Number.isFinite(bedroomCount) && bedroomCount >= 0) {
    return bedroomCount;
  }

  const label = lower(bedroomLabel);
  if (label.includes("studio")) {
    return 0;
  }

  const match = /(\d+(?:\.\d+)?)\s*(?:bed|br|bedroom)/.exec(label);
  if (match?.[1] !== undefined) {
    return Number(match[1]);
  }

  return null;
}

export function matchBedroomFilter(
  listing: Pick<ListingEvaluationInput, "bedroomCount" | "bedroomLabel">,
  filter: BedroomFilter
): BedroomFilterMatch {
  const normalizedBedroomCount = normalizeBedroomCount(listing.bedroomCount, listing.bedroomLabel);

  if (filter === "any_entire_place") {
    return {
      normalizedBedroomCount,
      reason: "Any bedroom count is allowed for entire-place searches.",
      status: "match"
    };
  }

  if (normalizedBedroomCount === null) {
    const exactOrMinimumFilters: BedroomFilter[] = [
      "studio_only",
      "one_bedroom_only",
      "exactly_two_bedrooms",
      "two_bedrooms_plus"
    ];

    return {
      normalizedBedroomCount,
      reason: exactOrMinimumFilters.includes(filter)
        ? "Bedroom count is required for this precise bedroom filter."
        : "Bedroom count is unknown but could plausibly match this filter.",
      status: exactOrMinimumFilters.includes(filter) ? "unknown_needs_cleanup" : "unknown_plausible"
    };
  }

  const matches =
    (filter === "studio_only" && normalizedBedroomCount === 0) ||
    (filter === "studio_or_1br" && (normalizedBedroomCount === 0 || normalizedBedroomCount === 1)) ||
    (filter === "studio_plus" && normalizedBedroomCount >= 0) ||
    (filter === "one_bedroom_only" && normalizedBedroomCount === 1) ||
    (filter === "exactly_two_bedrooms" && normalizedBedroomCount === 2) ||
    (filter === "two_bedrooms_plus" && normalizedBedroomCount >= 2);

  return {
    normalizedBedroomCount,
    reason: matches ? "Bedroom count matches the active filter." : "Bedroom count does not match the active filter.",
    status: matches ? "match" : "no_match"
  };
}

function evaluateDateFit(
  listing: Pick<ListingEvaluationInput, "source" | "dateWindow">,
  settings: SearchSettings
): DateFitEvaluation {
  const targetStartPrimary = parseIsoDate(settings.targetStartPrimary);
  const targetStartSecondary = parseIsoDate(settings.targetStartSecondary);
  const targetEnd = parseIsoDate(settings.targetEnd);
  const earliestMoveIn = parseIsoDate(listing.dateWindow.earliestMoveIn);
  const latestMoveIn = parseIsoDate(listing.dateWindow.latestMoveIn);
  const latestMoveOut = parseIsoDate(listing.dateWindow.latestMoveOut);
  const reasons: string[] = [];
  const cleanupActions: CleanupAction[] = [];
  const riskFlags: RiskFlag[] = [];

  if (targetStartPrimary === null || targetStartSecondary === null || targetEnd === null) {
    return {
      cleanupActions: [cleanupAction("settings_dates_invalid", "Fix target search dates in settings.", "settings.dates")],
      hardExcluded: false,
      needsCleanup: true,
      reasons: ["Target search dates are invalid."],
      riskFlags: [riskFlag("settings_dates_invalid", "Target search dates are invalid.", "critical")],
      score: 6
    };
  }

  if (earliestMoveIn !== null && compareDates(earliestMoveIn, targetStartSecondary) > 0) {
    return {
      cleanupActions,
      hardExcluded: true,
      needsCleanup: false,
      reasons: ["Available move-in starts after July 1."],
      riskFlags: [riskFlag("date_gap_after_start", "Move-in starts after the target start date.", "critical")],
      score: 0
    };
  }

  if (latestMoveOut !== null && compareDates(latestMoveOut, targetEnd) < 0) {
    return {
      cleanupActions,
      hardExcluded: true,
      needsCleanup: false,
      reasons: ["Available move-out ends before September 12."],
      riskFlags: [riskFlag("date_ends_too_early", "Move-out window ends before the target end date.", "critical")],
      score: 0
    };
  }

  const missingStartData = earliestMoveIn === null && latestMoveIn === null;
  const missingEndData = latestMoveOut === null && !listing.dateWindow.monthToMonth;

  if (missingStartData || missingEndData) {
    cleanupActions.push(cleanupAction("confirm_date_coverage", "Confirm the listing covers June 30 or July 1 through September 12.", "dateWindow"));
    riskFlags.push(riskFlag("date_unknown", "Date coverage is not confirmed.", "warning"));
    reasons.push("Date fields are missing but may be eligible.");

    return {
      cleanupActions,
      hardExcluded: false,
      needsCleanup: true,
      reasons,
      riskFlags,
      score: 6
    };
  }

  if (latestMoveIn !== null && compareDates(latestMoveIn, targetStartPrimary) < 0) {
    const daysEarly = compareDates(targetStartPrimary, latestMoveIn);
    const score = daysEarly <= 7 ? 13 : daysEarly <= 14 ? 10 : 8;
    const label =
      daysEarly <= 7
        ? "Listing requires starting a few days early."
        : "Listing may require paying for a significantly earlier start.";

    reasons.push(label);
    riskFlags.push(riskFlag("early_start_required", label, daysEarly <= 7 ? "info" : "warning"));

    return {
      cleanupActions,
      hardExcluded: false,
      needsCleanup: false,
      reasons,
      riskFlags,
      score
    };
  }

  const immediateRisk = listing.source === "leasebreak" && hasImmediateMoveInSignal(listing.dateWindow);
  if (immediateRisk) {
    const label = "Leasebreak listing appears to prefer immediate move-in; ask whether July 1 is acceptable.";
    cleanupActions.push(cleanupAction("ask_july_start_ok", "Ask whether a June 30 or July 1 start is acceptable.", "dateWindow.latestMoveIn"));
    riskFlags.push(riskFlag("leasebreak_immediate_move_in_risk", label, "warning"));
    reasons.push("Leasebreak window works but immediate move-in preference creates risk.");

    return {
      cleanupActions,
      hardExcluded: false,
      needsCleanup: false,
      reasons,
      riskFlags,
      score: 8
    };
  }

  if (listing.dateWindow.monthToMonth && latestMoveOut === null) {
    cleanupActions.push(cleanupAction("confirm_month_to_month_full_stay", "Confirm month-to-month terms can cover the full internship.", "dateWindow.monthToMonth"));
    riskFlags.push(riskFlag("month_to_month_uncertain", "Month-to-month listing needs full-stay confirmation.", "warning"));
    reasons.push("Month-to-month listing may cover the full period.");

    return {
      cleanupActions,
      hardExcluded: false,
      needsCleanup: true,
      reasons,
      riskFlags,
      score: 10
    };
  }

  const exactTargetStart =
    isSameDate(earliestMoveIn, targetStartPrimary) ||
    isSameDate(earliestMoveIn, targetStartSecondary) ||
    (earliestMoveIn !== null &&
      latestMoveIn !== null &&
      compareDates(earliestMoveIn, targetStartPrimary) <= 0 &&
      compareDates(latestMoveIn, targetStartSecondary) >= 0);

  if (exactTargetStart) {
    reasons.push("Covers June 30 or July 1 through September 12 or later.");
    return {
      cleanupActions,
      hardExcluded: false,
      needsCleanup: false,
      reasons,
      riskFlags,
      score: 15
    };
  }

  reasons.push("Date window appears plausible but should be confirmed.");
  cleanupActions.push(cleanupAction("confirm_date_window", "Confirm the exact move-in and move-out dates.", "dateWindow"));
  riskFlags.push(riskFlag("date_window_uncertain", "Date window is plausible but not exact.", "warning"));

  return {
    cleanupActions,
    hardExcluded: false,
    needsCleanup: true,
    reasons,
    riskFlags,
    score: 6
  };
}

function commuteRiskFlags(commute: CommuteSummary | null, settings: SearchSettings): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (commute === null || commute.totalMinutes === null) {
    flags.push(riskFlag("commute_unknown", "Commute needs to be estimated or confirmed.", "warning"));
    return flags;
  }

  if (commute.totalMinutes > settings.acceptableCommuteMinutes) {
    flags.push(riskFlag("commute_over_acceptable", "Commute is over the acceptable range.", "warning"));
  }

  if (commute.walkMinutes !== null && commute.walkMinutes > settings.heavyWalkMinutes) {
    flags.push(riskFlag("heavy_walk_to_transit", "Walk to transit is over the heavy-walk threshold.", "warning"));
  } else if (commute.walkMinutes !== null && commute.walkMinutes > settings.longWalkMinutes) {
    flags.push(riskFlag("long_walk_to_transit", "Walk to transit is over the long-walk threshold.", "warning"));
  }

  if (commute.hasBusHeavyRoute) {
    flags.push(riskFlag("bus_heavy_route", "Route is bus-heavy.", "warning"));
  }

  return flags;
}

export function isAirbnbApproximateLocation(
  listingOrLocation: Pick<ListingEvaluationInput, "source" | "location"> | ListingLocation | null
): boolean {
  if (listingOrLocation === null) {
    return false;
  }

  if ("location" in listingOrLocation) {
    return listingOrLocation.source === "airbnb" && listingOrLocation.location?.source === "airbnb_approx_pin";
  }

  return listingOrLocation.source === "airbnb_approx_pin";
}

export function generateCleanupActions(
  listing: ListingEvaluationInput,
  settings: SearchSettings = DEFAULT_SEARCH_SETTINGS
): CleanupAction[] {
  const actions: CleanupAction[] = [];
  const dateFit = evaluateDateFit(listing, settings);
  const bedroomMatch = matchBedroomFilter(listing, settings.defaultBedroomFilter);

  if (listing.monthlyRent === null) {
    actions.push(cleanupAction("confirm_monthly_rent", "Confirm advertised monthly rent.", "monthlyRent"));
  }

  if (listing.stayType === "unknown") {
    actions.push(cleanupAction("confirm_stay_type", "Confirm whether this is an entire apartment or private room.", "stayType"));
  }

  if (bedroomMatch.status === "unknown_needs_cleanup" || bedroomMatch.status === "unknown_plausible") {
    actions.push(cleanupAction("confirm_bedroom_count", "Confirm bedroom count for the active bedroom filter.", "bedroomCount"));
  }

  if (listing.location === null || listing.location.geographyCategory === "unknown") {
    actions.push(cleanupAction("confirm_location", "Confirm address, cross streets, or neighborhood.", "location"));
  }

  if (listing.commute === null || listing.commute.totalMinutes === null) {
    actions.push(cleanupAction("confirm_commute", "Estimate commute to Ramp.", "commute"));
  }

  if (listing.kitchen === "unknown") {
    actions.push(cleanupAction("confirm_kitchen", "Confirm kitchen access.", "kitchen"));
  }

  if (listing.bathroomType === "unknown" && listing.stayType !== "entire_apartment") {
    actions.push(cleanupAction("confirm_bathroom", "Confirm whether the bathroom is private or shared.", "bathroomType"));
  }

  if (listing.washer === "unknown") {
    actions.push(cleanupAction("confirm_washer", "Confirm washer access.", "washer"));
  }

  if (listing.furnished === "unknown") {
    actions.push(cleanupAction("confirm_furnished", "Confirm whether the listing is furnished.", "furnished"));
  }

  actions.push(...dateFit.cleanupActions);

  return uniqueByCode(actions);
}

function generateRiskFlags(listing: ListingEvaluationInput, settings: SearchSettings): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const dateFit = evaluateDateFit(listing, settings);

  if (listing.monthlyRent !== null && listing.monthlyRent > settings.maxMonthlyRent) {
    flags.push(riskFlag("over_budget", "Advertised rent exceeds the hard cap.", "critical"));
  }

  if (listing.stayType === "private_room") {
    flags.push(riskFlag("private_room_fallback", "Private room is a fallback option.", "warning"));
  } else if (listing.stayType === "shared_room") {
    flags.push(riskFlag("shared_room_excluded", "Shared rooms are not currently allowed.", "critical"));
  }

  if (isAirbnbApproximateLocation(listing)) {
    flags.push(riskFlag("airbnb_approx_location", "Airbnb location is approximate; commute should be labeled as estimated.", "info"));
  }

  if (listing.location === null || listing.location.geographyCategory === "unknown") {
    flags.push(riskFlag("location_unknown", "Location needs confirmation.", "warning"));
  }

  flags.push(...dateFit.riskFlags, ...commuteRiskFlags(listing.commute, settings));

  return uniqueByCode(flags);
}

export function evaluateHardFilters(
  listing: ListingEvaluationInput,
  settings: SearchSettings = DEFAULT_SEARCH_SETTINGS
): HardFilterEvaluation {
  const reasons: string[] = [];
  const cleanupActions: CleanupAction[] = [];
  const riskFlags: RiskFlag[] = [];
  let hasExcluded = false;
  let hasFallbackOnly = false;
  let hasNeedsCleanup = false;

  if (listing.monthlyRent === null) {
    hasNeedsCleanup = true;
    cleanupActions.push(cleanupAction("confirm_monthly_rent", "Confirm advertised monthly rent.", "monthlyRent"));
    reasons.push("Advertised monthly rent is unknown.");
  } else if (listing.monthlyRent > settings.maxMonthlyRent) {
    hasExcluded = true;
    reasons.push(`Advertised rent is $${listing.monthlyRent}, above the $${settings.maxMonthlyRent} hard cap.`);
    riskFlags.push(riskFlag("over_budget", "Advertised rent exceeds the hard cap.", "critical"));
  }

  if (listing.stayType === "unknown") {
    hasNeedsCleanup = true;
    cleanupActions.push(cleanupAction("confirm_stay_type", "Confirm whether this is an entire apartment or private room.", "stayType"));
    reasons.push("Stay type is unknown.");
  } else if (listing.stayType === "shared_room") {
    hasExcluded = true;
    reasons.push("Shared rooms are not currently allowed.");
    riskFlags.push(riskFlag("shared_room_excluded", "Shared rooms are not currently allowed.", "critical"));
  } else if (listing.stayType === "private_room" && !settings.panicModeEnabled) {
    hasFallbackOnly = true;
    reasons.push("Private room hidden until Panic/Fallback Mode is enabled.");
    riskFlags.push(riskFlag("private_room_fallback", "Private room is a fallback option.", "warning"));
  }

  const bedroomMatch = matchBedroomFilter(listing, settings.defaultBedroomFilter);
  if (bedroomMatch.status === "no_match") {
    hasExcluded = true;
    reasons.push(bedroomMatch.reason);
    riskFlags.push(riskFlag("bedroom_filter_mismatch", "Bedroom count does not match the active filter.", "critical"));
  } else if (bedroomMatch.status === "unknown_needs_cleanup") {
    hasNeedsCleanup = true;
    cleanupActions.push(cleanupAction("confirm_bedroom_count", "Confirm bedroom count for the active bedroom filter.", "bedroomCount"));
    reasons.push(bedroomMatch.reason);
  } else if (bedroomMatch.status === "unknown_plausible") {
    cleanupActions.push(cleanupAction("confirm_bedroom_count", "Confirm bedroom count for the active bedroom filter.", "bedroomCount"));
  }

  const dateFit = evaluateDateFit(listing, settings);
  if (dateFit.hardExcluded) {
    hasExcluded = true;
  } else if (dateFit.needsCleanup) {
    hasNeedsCleanup = true;
  }
  reasons.push(...dateFit.reasons);
  cleanupActions.push(...dateFit.cleanupActions);
  riskFlags.push(...dateFit.riskFlags);

  if (listing.commute === null || listing.commute.totalMinutes === null) {
    hasNeedsCleanup = true;
    cleanupActions.push(cleanupAction("confirm_commute", "Estimate commute to Ramp.", "commute"));
    reasons.push("Commute is unknown.");
  } else if (listing.commute.totalMinutes > settings.acceptableCommuteMinutes) {
    const label = `Commute is ${listing.commute.totalMinutes} minutes, over the ${settings.acceptableCommuteMinutes}-minute acceptable range.`;
    reasons.push(label);
    riskFlags.push(riskFlag("commute_over_acceptable", "Commute is over the acceptable range.", "warning"));
    if (!settings.panicModeEnabled) {
      hasFallbackOnly = true;
    }
  }

  const status = hasExcluded ? "excluded" : hasFallbackOnly ? "fallback_only" : hasNeedsCleanup ? "needs_cleanup" : "included";

  return {
    cleanupActions: uniqueByCode(cleanupActions),
    reasons: [...new Set(reasons)],
    riskFlags: uniqueByCode(riskFlags),
    status
  };
}

function scoreCommute(commute: CommuteSummary | null, settings: SearchSettings): number {
  const totalMinutes = commute?.totalMinutes ?? null;
  const transferCount = commute?.transferCount ?? null;
  const walkMinutes = commute?.walkMinutes ?? null;

  const timeScore =
    totalMinutes === null
      ? 15
      : totalMinutes <= settings.idealCommuteMinutes
        ? 20
        : totalMinutes <= 30
          ? 15
          : totalMinutes <= settings.acceptableCommuteMinutes
            ? 8
            : 0;

  const transferScore =
    transferCount === null ? 4 : transferCount === 0 ? 6 : transferCount === 1 ? 4 : transferCount === 2 ? 1 : 0;

  const walkScore =
    walkMinutes === null ? 6 : walkMinutes <= settings.longWalkMinutes ? 6 : walkMinutes <= settings.heavyWalkMinutes ? 2 : 0;

  const modeScore = commute?.hasBusHeavyRoute === true ? 0 : commute?.routeSummary?.toLowerCase().includes("bus") ? 2 : 3;

  return timeScore + transferScore + walkScore + modeScore;
}

function scoreLocation(location: ListingLocation | null): number {
  switch (location?.geographyCategory ?? "unknown") {
    case "manhattan":
      return 20;
    case "lic_astoria":
      return 14;
    case "brooklyn":
      return 8;
    case "other":
      return 2;
    case "unknown":
      return 10;
  }
}

function scorePrice(monthlyRent: number | null, settings: SearchSettings): number {
  if (monthlyRent === null) {
    return 9;
  }
  if (monthlyRent > settings.maxMonthlyRent) {
    return 0;
  }
  if (monthlyRent <= 2800) {
    return 15;
  }
  if (monthlyRent <= 3200) {
    return 12;
  }
  if (monthlyRent <= 3450) {
    return 9;
  }
  return 6;
}

function scoreAmenities(listing: ListingEvaluationInput): number {
  const kitchenScore = listing.kitchen === "no" ? 0 : 3;
  const bathroomScore =
    listing.stayType === "entire_apartment" || listing.bathroomType === "private" || listing.bathroomType === "unknown" ? 3 : 0;
  const washerScore = listing.washer === "in_unit" || listing.washer === "in_building" || listing.washer === "unknown" ? 2 : 0;
  const furnishedScore = listing.furnished === "yes" || listing.furnished === "unknown" ? 2 : 0;
  return kitchenScore + bathroomScore + washerScore + furnishedScore;
}

function scoreStayBedroom(listing: ListingEvaluationInput, settings: SearchSettings): number {
  if (listing.stayType === "shared_room") {
    return 0;
  }

  const bedroomMatch = matchBedroomFilter(listing, settings.defaultBedroomFilter);
  if (listing.stayType === "private_room") {
    return settings.panicModeEnabled ? 3 : 0;
  }

  return bedroomMatch.status === "no_match" ? 0 : 5;
}

function buildScoreExplanation(
  listing: ListingEvaluationInput,
  scores: Pick<
    ScoreBreakdown,
    "commuteScore" | "locationScore" | "priceScore" | "dateScore" | "amenityScore" | "stayBedroomScore" | "totalScore" | "hardFilterStatus"
  >,
  riskFlags: RiskFlag[]
): string {
  const fragments: string[] = [`Score ${scores.totalScore}/100.`];

  if (scores.hardFilterStatus === "excluded") {
    fragments.push("Excluded by hard filters.");
  } else if (scores.hardFilterStatus === "fallback_only") {
    fragments.push("Visible only as a fallback option.");
  } else if (scores.hardFilterStatus === "needs_cleanup") {
    fragments.push("Needs cleanup before fully trusting the ranking.");
  }

  if (listing.commute?.totalMinutes !== null && listing.commute?.totalMinutes !== undefined) {
    const transfers = listing.commute.transferCount === null ? "unknown transfers" : `${listing.commute.transferCount} transfers`;
    fragments.push(`Commute: ${listing.commute.totalMinutes} minutes, ${transfers}.`);
  }

  if (listing.monthlyRent !== null) {
    fragments.push(`Advertised rent: $${listing.monthlyRent}.`);
  }

  if (listing.location?.geographyCategory !== undefined) {
    fragments.push(`Location category: ${listing.location.geographyCategory}.`);
  }

  const warning = riskFlags.find((flag) => flag.severity !== "info");
  if (warning !== undefined) {
    fragments.push(`Risk: ${warning.label}`);
  }

  return fragments.join(" ");
}

export function calculatePamilaScore(
  listing: ListingEvaluationInput,
  settings: SearchSettings = DEFAULT_SEARCH_SETTINGS
): ScoreBreakdown {
  const hardFilter = evaluateHardFilters(listing, settings);
  const dateFit = evaluateDateFit(listing, settings);
  const cleanupActions = uniqueByCode([...generateCleanupActions(listing, settings), ...hardFilter.cleanupActions, ...dateFit.cleanupActions]);
  const riskFlags = uniqueByCode([...generateRiskFlags(listing, settings), ...hardFilter.riskFlags, ...dateFit.riskFlags]);
  const commuteScore = scoreCommute(listing.commute, settings);
  const locationScore = scoreLocation(listing.location);
  const priceScore = scorePrice(listing.monthlyRent, settings);
  const dateScore = dateFit.score;
  const amenityScore = scoreAmenities(listing);
  const stayBedroomScore = scoreStayBedroom(listing, settings);
  const rawTotal = commuteScore + locationScore + priceScore + dateScore + amenityScore + stayBedroomScore;
  const totalScore = hardFilter.status === "excluded" ? 0 : Math.max(0, Math.min(100, rawTotal));

  const scores = {
    amenityScore,
    commuteScore,
    dateScore,
    hardFilterStatus: hardFilter.status,
    locationScore,
    priceScore,
    stayBedroomScore,
    totalScore
  };

  return {
    ...scores,
    cleanupActions,
    hardFilterReasons: hardFilter.reasons,
    riskFlags,
    scoreExplanation: buildScoreExplanation(listing, scores, riskFlags)
  };
}

export function isFallbackOnly(
  listing: ListingEvaluationInput,
  settings: SearchSettings = DEFAULT_SEARCH_SETTINGS
): boolean {
  if (listing.stayType === "private_room") {
    return true;
  }

  const hardFilter = evaluateHardFilters(listing, settings);
  return hardFilter.status === "fallback_only";
}

function inferSourceFromUrl(parsedUrl: URL): ListingSource | null {
  const hostname = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
  if (hostname.endsWith("airbnb.com")) {
    return "airbnb";
  }
  if (hostname.endsWith("leasebreak.com")) {
    return "leasebreak";
  }
  return null;
}

export function canonicalizeListingUrl(url: string, source?: ListingSource): string {
  const trimmed = url.trim();

  try {
    const parsedUrl = new URL(trimmed);
    const resolvedSource = source ?? inferSourceFromUrl(parsedUrl);
    const hostname = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();

    if (resolvedSource === "airbnb") {
      const roomMatch = /\/rooms\/(\d+)/i.exec(parsedUrl.pathname);
      if (roomMatch?.[1] !== undefined) {
        return `https://www.airbnb.com/rooms/${roomMatch[1]}`;
      }
      return `https://www.airbnb.com${parsedUrl.pathname.replace(/\/+$/, "")}`;
    }

    if (resolvedSource === "leasebreak") {
      return `https://www.leasebreak.com${parsedUrl.pathname.replace(/\/+$/, "")}`;
    }

    return `${parsedUrl.protocol}//${hostname}${parsedUrl.pathname.replace(/\/+$/, "")}`;
  } catch {
    return trimmed.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

export function getListingDuplicateKey(source: ListingSource, url: string): string {
  return `${source}:${canonicalizeListingUrl(url, source)}`;
}

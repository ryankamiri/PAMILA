import type { ListingSource, StayType, ThumbnailCandidate } from "@pamila/core";

export const SUPPORTED_SOURCE_HOSTS = {
  airbnb: ["airbnb.com", "www.airbnb.com"],
  leasebreak: ["leasebreak.com", "www.leasebreak.com"]
} as const;

const MONTH_NAMES =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

export function detectListingSource(url: string): ListingSource | null {
  let hostname: string;

  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (hostname === "airbnb.com" || hostname.endsWith(".airbnb.com")) {
    return "airbnb";
  }

  if (hostname === "leasebreak.com" || hostname.endsWith(".leasebreak.com")) {
    return "leasebreak";
  }

  return null;
}

export function truncateText(value: string | null | undefined, limit: number): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > limit ? normalized.slice(0, limit).trimEnd() : normalized;
}

export function extractVisibleFieldsFromText(source: ListingSource, text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const normalized = text.replace(/\s+/g, " ").trim();

  const rent = findFirstMatch(normalized, [
    /\$[\d,]+(?:\s*(?:\/\s*)?(?:month|mo|monthly))\b/i,
    /\$[\d,]+(?=\s+per\s+month\b)/i,
    /\$[\d,]+/i
  ]);
  if (rent) {
    fields.monthly_rent_candidate = rent;
  }

  const bedroom = findFirstMatch(normalized, [
    /\bstudio\b/i,
    /\b\d+(?:\.\d+)?\s*(?:bedrooms?|beds?|br)\b/i
  ]);
  if (bedroom) {
    fields.bedroom_candidate = bedroom;
  }

  const bathroom = findFirstMatch(normalized, [
    /\b(private|shared)\s+bath(?:room)?\b/i,
    /\b\d+(?:\.\d+)?\s+bath(?:rooms?)?\b/i
  ]);
  if (bathroom) {
    fields.bathroom_candidate = bathroom;
  }

  const stayType = inferStayType(normalized);
  if (stayType !== "unknown") {
    fields.stay_type_candidate = stayType;
  }

  if (/\bkitchen\b/i.test(normalized)) {
    fields.kitchen_candidate = "mentioned";
  }

  if (/\bwasher\b|\blaundry\b/i.test(normalized)) {
    fields.washer_candidate = inferWasherValue(normalized);
  }

  if (/\bfurnished\b/i.test(normalized)) {
    fields.furnished_candidate = /\bunfurnished\b/i.test(normalized) ? "no" : "yes";
  }

  if (source === "leasebreak") {
    addDateCandidate(fields, normalized, "earliest_move_in_candidate", /earliest\s+move[-\s]?in\s+date\s*:?\s*([^|]{1,80}?)(?=\s+(?:latest|earliest\s+move[-\s]?out|$))/i);
    addDateCandidate(fields, normalized, "latest_move_in_candidate", /latest\s+move[-\s]?in\s+date\s*:?\s*([^|]{1,80}?)(?=\s+(?:earliest\s+move[-\s]?out|latest\s+move[-\s]?out|$))/i);
    addDateCandidate(fields, normalized, "earliest_move_out_candidate", /earliest\s+move[-\s]?out\s+date\s*:?\s*([^|]{1,80}?)(?=\s+(?:latest\s+move[-\s]?out|$))/i);
    addDateCandidate(fields, normalized, "latest_move_out_candidate", /latest\s+move[-\s]?out\s+date\s*:?\s*([^|]{1,80})/i);
    Object.assign(fields, extractLeasebreakSourceFields(normalized));

    if (/\bimmediate\b/i.test(normalized)) {
      fields.move_in_urgency_candidate = "immediate";
    }
  }

  if (source === "airbnb") {
    Object.assign(fields, extractAirbnbSourceFields(normalized));
  }

  if (/\bmonth[-\s]?to[-\s]?month\b/i.test(normalized)) {
    fields.month_to_month_candidate = "yes";
  }

  return fields;
}

export function extractApproxAirbnbLocationFromText(text: string): { label: string; neighborhood: string | null } | null {
  const neighborhood = detectKnownNeighborhood(text);
  if (neighborhood) {
    return {
      label: neighborhood,
      neighborhood
    };
  }

  const patterns = [
    /where\s+you[’']?ll\s+be\s+([^|]{3,120}?)(?=\s+(?:this listing|guests say|learn more|location is|hosted by|photos|amenities|reviews|reserve)|$)/i,
    /location\s+([^.,|]{3,80})/i,
    /neighborhood\s+([^.,|]{3,80})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const label = sanitizeFieldValue(match?.[1] ?? null);
    if (label && !isGenericAirbnbLocationLabel(label)) {
      return {
        label,
        neighborhood: label
      };
    }
  }

  return null;
}

function extractAirbnbSourceFields(text: string): Record<string, string> {
  return {
    ...extractAirbnbMonthlyRentFields(text),
    ...extractAirbnbBedroomFields(text),
    ...extractAirbnbAvailabilityFields(text),
    ...extractAirbnbLocationFields(text)
  };
}

function extractAirbnbMonthlyRentFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const monthlyPair = Array.from(
    text.matchAll(
      /\$([1-9][\d,]{2,})\s*(?:(?:monthly|month|\/\s*month|mo\b)\s+)?\$([1-9][\d,]{2,})\s*(?:monthly|month|\/\s*month|mo\b)/gi
    )
  ).find((match) => {
    const original = parseCurrencyAmount(match[1] ?? "");
    const current = parseCurrencyAmount(match[2] ?? "");
    return original !== null && current !== null && original > current && current >= 1_000 && current <= 10_000;
  });

  if (monthlyPair?.[1] && monthlyPair[2]) {
    fields.airbnb_original_monthly_rent = `$${monthlyPair[1]} monthly`;
    fields.airbnb_current_monthly_rent = `$${monthlyPair[2]} monthly`;
    fields.monthly_rent_candidate = fields.airbnb_current_monthly_rent;
    return fields;
  }

  const monthlyPrice = findFirstMatch(text, [
    /\$[1-9][\d,]{2,}\s*(?:monthly|month|\/\s*month|mo\b)/i,
    /\$[1-9][\d,]{2,}(?=\s+monthly\b)/i
  ]);
  if (monthlyPrice) {
    fields.airbnb_current_monthly_rent = monthlyPrice;
    fields.monthly_rent_candidate = monthlyPrice;
  }

  return fields;
}

function extractLeasebreakSourceFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const address = sanitizeFieldValue(
    text.match(/\b\d{1,5}\s+[A-Z0-9][A-Za-z0-9 .'-]{1,80}?\s(?:st|street|ave|avenue|broadway|blvd|boulevard|rd|road)\b/i)?.[0] ?? null
  );
  if (address) {
    fields.leasebreak_address = address;
    fields.location_candidate = address;
  }

  const neighborhood = detectKnownNeighborhood(text);
  if (neighborhood) {
    fields.leasebreak_neighborhood = neighborhood;
    fields.neighborhood_candidate = neighborhood;
  }

  const bedroomValue = sanitizeFieldValue(
    text.match(/\bbedrooms?\s*:?\s*(studio|[0-9]+(?:\.[0-9]+)?)(?=\s+(?:bathrooms?|decor|listing\s+type|posted\s+by|\$|earliest|last\s+updated)\b|$)/i)?.[1] ?? null
  );
  if (bedroomValue) {
    fields.leasebreak_bedroom_count = /^studio$/i.test(bedroomValue) ? "0" : bedroomValue;
    fields.bedroom_candidate = /^studio$/i.test(bedroomValue) ? "Studio" : `${bedroomValue} bedroom`;
  }

  const listingType = sanitizeFieldValue(
    text.match(
      /\blisting\s+type\s*:?\s*([a-z][a-z\s-]{2,60}?)(?=\s+(?:posted\s+by|decor|kind\s+of\s+building|opportunity|brokerage\s+fee|apartment\s+tours|virtual\s+live\s+tours|pre-recorded|features|property\s+details)\b|$)/i
    )?.[1] ?? null
  );
  if (listingType) {
    fields.leasebreak_listing_type = listingType;
    const stayType = mapLeasebreakListingTypeToStayType(listingType);
    if (stayType !== "unknown") {
      fields.stay_type_candidate = stayType;
    }
  }

  return fields;
}

function extractAirbnbBedroomFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const summary =
    findFirstMatch(text, [
      /\b\d+\s+guests?\s*[·•]\s*(?:studio|\d+\s+bedrooms?)\s*[·•]\s*\d+\s+beds?\s*[·•]\s*\d+(?:\.\d+)?\s+baths?\b/i,
      /\b(?:studio|\d+\s+bedrooms?)\s*[·•]\s*\d+\s+beds?\s*[·•]\s*\d+(?:\.\d+)?\s+baths?\b/i
    ]) ?? null;
  const bedroomText = summary ?? text;
  const explicitBedroom = /\b([1-9]\d*)\s+bedrooms?\b/i.exec(bedroomText);

  if (explicitBedroom?.[1]) {
    fields.airbnb_bedroom_summary = summary ?? explicitBedroom[0];
    fields.airbnb_bedroom_count = explicitBedroom[1];
    fields.bedroom_candidate = `${explicitBedroom[1]} bedroom`;
    return fields;
  }

  if (/\bstudio\b/i.test(bedroomText) && !/\b\d+\s+bedrooms?\b/i.test(bedroomText)) {
    fields.airbnb_bedroom_summary = summary ?? "Studio";
    fields.airbnb_bedroom_count = "0";
    fields.bedroom_candidate = "Studio";
  }

  return fields;
}

function extractAirbnbAvailabilityFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const monthRange = findFirstMatch(text, [
    new RegExp(
      `\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2},\\s+\\d{4}\\s*[-–]\\s*(?:${MONTH_NAMES})\\.?\\s+\\d{1,2},\\s+\\d{4}\\b`,
      "i"
    )
  ]);
  if (monthRange) {
    fields.airbnb_availability_summary = `Available ${monthRange.replace(/\s*[-–]\s*/, " to ")}`;
    return fields;
  }

  const checkInOut = text.match(
    /\bcheck-?in\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+check-?out\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i
  );
  if (checkInOut?.[1] && checkInOut[2]) {
    fields.airbnb_availability_summary = `Available ${checkInOut[1]} to ${checkInOut[2]}`;
  }

  return fields;
}

function extractAirbnbLocationFields(text: string): Record<string, string> {
  const location = extractApproxAirbnbLocationFromText(text);
  if (!location) {
    return {};
  }

  return {
    airbnb_location_confidence: "low",
    airbnb_location_label: location.label,
    airbnb_location_source: "airbnb_visible_text",
    neighborhood_candidate: location.neighborhood ?? location.label
  };
}

export function normalizeThumbnailCandidates(
  candidates: ThumbnailCandidate[],
  limit: number
): ThumbnailCandidate[] {
  const seen = new Set<string>();
  const normalized: ThumbnailCandidate[] = [];

  for (const candidate of candidates) {
    if (!isHttpImageUrl(candidate.url) || seen.has(candidate.url)) {
      continue;
    }

    seen.add(candidate.url);
    normalized.push({
      url: candidate.url,
      width: candidate.width,
      height: candidate.height
    });

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function inferStayType(text: string): StayType {
  if (/\bprivate\s+room\b/i.test(text)) {
    return "private_room";
  }

  if (/\bshared\s+room\b/i.test(text)) {
    return "shared_room";
  }

  if (/\bentire\s+(?:rental\s+unit|home|place|apartment|condo|loft|guest\s+suite)\b/i.test(text)) {
    return "entire_apartment";
  }

  return "unknown";
}

function mapLeasebreakListingTypeToStayType(listingType: string): StayType {
  if (/\bshared\s+(?:room|bedroom)\b/i.test(listingType)) {
    return "shared_room";
  }

  if (/\b(?:private\s+)?rooms?\b|\brooms?\s+for\s+rent\b/i.test(listingType)) {
    return "private_room";
  }

  if (/\b(short\s+term\s+rental|sublet|lease\s+assignment|leasebreak|rental)\b/i.test(listingType)) {
    return "entire_apartment";
  }

  return "unknown";
}

function inferWasherValue(text: string): string {
  if (/\bwasher\s+in\s+unit\b|\bin[-\s]?unit\s+(?:washer|laundry)\b/i.test(text)) {
    return "in_unit";
  }

  if (/\bwasher\s+in\s+building\b|\bin[-\s]?building\s+(?:washer|laundry)\b|\blaundry\s+in\s+building\b/i.test(text)) {
    return "in_building";
  }

  if (/\bno\s+washer\b|\bwasher\s+not\b/i.test(text)) {
    return "no";
  }

  return "mentioned";
}

function parseCurrencyAmount(value: string): number | null {
  const amount = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function detectKnownNeighborhood(text: string): string | null {
  const lower = text.toLowerCase();
  const neighborhoods: Array<[RegExp, string]> = [
    [/\bupper west side\b|\buws\b/, "Upper West Side"],
    [/\bupper east side\b|\bues\b/, "Upper East Side"],
    [/\blong island city\b|\blic\b/, "Long Island City"],
    [/\bastoria\b/, "Astoria"],
    [/\bchelsea\b/, "Chelsea"],
    [/\bflatiron\b/, "Flatiron"],
    [/\bgramercy\b/, "Gramercy"],
    [/\bunion square\b/, "Union Square"],
    [/\bnomad\b/, "NoMad"],
    [/\bmidtown west\b|\bhell['’]s kitchen\b/, "Midtown West / Hell's Kitchen"],
    [/\bmidtown\b/, "Midtown"],
    [/\bmurray hill\b/, "Murray Hill"],
    [/\bkips bay\b/, "Kips Bay"],
    [/\beast village\b/, "East Village"],
    [/\bwest village\b/, "West Village"],
    [/\bgreenwich village\b/, "Greenwich Village"],
    [/\bsoho\b/, "SoHo"],
    [/\btribeca\b/, "Tribeca"],
    [/\blower east side\b/, "Lower East Side"],
    [/\bfinancial district\b|\bfidi\b/, "Financial District"],
    [/\bharlem\b/, "Harlem"],
    [/\bwilliamsburg\b/, "Williamsburg"],
    [/\bgreenpoint\b/, "Greenpoint"],
    [/\bdumbo\b/, "DUMBO"],
    [/\bbrooklyn heights\b/, "Brooklyn Heights"],
    [/\bdowntown brooklyn\b/, "Downtown Brooklyn"],
    [/\bfort greene\b/, "Fort Greene"],
    [/\bclinton hill\b/, "Clinton Hill"],
    [/\bpark slope\b/, "Park Slope"],
    [/\bbushwick\b/, "Bushwick"],
    [/\bbed-stuy\b|\bbedford-stuyvesant\b/, "Bed-Stuy"]
  ];

  return neighborhoods.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
}

function isGenericAirbnbLocationLabel(label: string): boolean {
  return /^(new york|new york, united states|nyc|united states)$/i.test(label.trim());
}

function addDateCandidate(fields: Record<string, string>, text: string, key: string, pattern: RegExp): void {
  const value = sanitizeFieldValue(text.match(pattern)?.[1] ?? null);
  if (!value) {
    return;
  }

  fields[key] = findFirstMatch(value, [
    new RegExp(`\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, "i"),
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
    /\bimmediate\b/i,
    /\bflexible\b/i
  ]) ?? value;
}

function findFirstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = sanitizeFieldValue(match?.[0] ?? null);
    if (value) {
      return value;
    }
  }

  return null;
}

function sanitizeFieldValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").replace(/^[\s:,-]+|[\s:,-]+$/g, "").trim();
  return cleaned || null;
}

function isHttpImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  if (/^data:/i.test(url) || /\.svg(?:$|\?)/i.test(url)) {
    return false;
  }

  return true;
}

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

    if (/\bimmediate\b/i.test(normalized)) {
      fields.move_in_urgency_candidate = "immediate";
    }
  }

  if (/\bmonth[-\s]?to[-\s]?month\b/i.test(normalized)) {
    fields.month_to_month_candidate = "yes";
  }

  return fields;
}

export function extractApproxAirbnbLocationFromText(text: string): { label: string; neighborhood: string | null } | null {
  const patterns = [
    /where\s+you[’']?ll\s+be\s+([^.,|]{3,80})/i,
    /location\s+([^.,|]{3,80})/i,
    /neighborhood\s+([^.,|]{3,80})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const label = sanitizeFieldValue(match?.[1] ?? null);
    if (label) {
      return {
        label,
        neighborhood: label
      };
    }
  }

  return null;
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

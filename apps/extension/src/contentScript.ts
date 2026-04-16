const pamilaContentScriptMarker = "pamila-content-script-ready";
const captureMessageType = "PAMILA_CAPTURE_CURRENT_PAGE";
const defaultPageTextLimit = 12_000;
const defaultSelectedTextLimit = 4_000;
const defaultThumbnailLimit = 8;

type ListingSource = "airbnb" | "leasebreak";

interface CaptureRequestMessage {
  type: typeof captureMessageType;
  settings?: {
    pageTextLimit?: number;
    selectedTextLimit?: number;
    thumbnailLimit?: number;
  };
}

interface ThumbnailCandidate {
  url: string;
  width: number | null;
  height: number | null;
}

interface ListingLocation {
  label: string;
  address: string | null;
  crossStreets: string | null;
  neighborhood: string | null;
  geographyCategory: "manhattan" | "lic_astoria" | "brooklyn" | "other" | "unknown";
  lat: number | null;
  lng: number | null;
  source: "exact_address" | "cross_streets" | "airbnb_approx_pin" | "neighborhood" | "manual_guess";
  confidence: "exact" | "high" | "medium" | "low";
  isUserConfirmed: boolean;
}

interface CapturePayload {
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

document.documentElement.dataset.pamilaCapture = pamilaContentScriptMarker;

chrome.runtime.onMessage.addListener((message: CaptureRequestMessage, _sender, sendResponse) => {
  if (message?.type !== captureMessageType) {
    return false;
  }

  try {
    sendResponse({
      ok: true,
      payload: buildCapturePayload(message)
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown capture error."
    });
  }

  return true;
});

function buildCapturePayload(message: CaptureRequestMessage): CapturePayload {
  const source = detectListingSource(window.location.href);
  if (!source) {
    throw new Error("This page is not an Airbnb or Leasebreak listing.");
  }

  const pageTextLimit = normalizePositiveInteger(message.settings?.pageTextLimit, defaultPageTextLimit);
  const selectedTextLimit = normalizePositiveInteger(message.settings?.selectedTextLimit, defaultSelectedTextLimit);
  const thumbnailLimit = normalizePositiveInteger(message.settings?.thumbnailLimit, defaultThumbnailLimit);
  const pageText = truncateText(getVisiblePageText(), pageTextLimit);
  const selectedText = truncateText(window.getSelection()?.toString() ?? null, selectedTextLimit);
  const textForParsing = [document.title, selectedText, pageText].filter(Boolean).join(" ");

  return {
    source,
    url: window.location.href,
    title: truncateText(document.title, 300),
    visibleFields: extractVisibleFieldsFromText(source, textForParsing),
    selectedText,
    pageText,
    approxLocation: source === "airbnb" ? extractApproxAirbnbLocation(textForParsing) : null,
    thumbnailCandidates: extractThumbnailCandidates(thumbnailLimit),
    capturedAt: new Date().toISOString()
  };
}

function detectListingSource(url: string): ListingSource | null {
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

function getVisiblePageText(): string | null {
  const body = document.body;
  if (!body) {
    return null;
  }

  return body.innerText || body.textContent;
}

function extractVisibleFieldsFromText(source: ListingSource, text: string): Record<string, string> {
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

function extractApproxAirbnbLocation(text: string): ListingLocation | null {
  const coordinates = extractCoordinates();
  const label = extractAirbnbLocationLabel(text) ?? "Airbnb approximate location";

  if (!coordinates && label === "Airbnb approximate location") {
    return null;
  }

  return {
    label,
    address: null,
    crossStreets: null,
    neighborhood: label === "Airbnb approximate location" ? null : label,
    geographyCategory: "unknown",
    lat: coordinates?.lat ?? null,
    lng: coordinates?.lng ?? null,
    source: "airbnb_approx_pin",
    confidence: coordinates ? "medium" : "low",
    isUserConfirmed: false
  };
}

function extractCoordinates(): { lat: number; lng: number } | null {
  const metaLatitude = readMetaContent(["place:location:latitude", "og:latitude", "latitude"]);
  const metaLongitude = readMetaContent(["place:location:longitude", "og:longitude", "longitude"]);
  const lat = metaLatitude ? Number.parseFloat(metaLatitude) : Number.NaN;
  const lng = metaLongitude ? Number.parseFloat(metaLongitude) : Number.NaN;

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  const coordinateMatch = window.location.href.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (coordinateMatch?.[1] && coordinateMatch[2]) {
    return {
      lat: Number.parseFloat(coordinateMatch[1]),
      lng: Number.parseFloat(coordinateMatch[2])
    };
  }

  return null;
}

function extractAirbnbLocationLabel(text: string): string | null {
  const match =
    text.match(/where\s+you[’']?ll\s+be\s+([^.,|]{3,80})/i) ??
    text.match(/neighborhood\s+([^.,|]{3,80})/i) ??
    text.match(/location\s+([^.,|]{3,80})/i);

  return sanitizeFieldValue(match?.[1] ?? null);
}

function extractThumbnailCandidates(limit: number): ThumbnailCandidate[] {
  const candidates: ThumbnailCandidate[] = [];
  const metaImage = readMetaContent(["og:image", "twitter:image"]);

  if (metaImage) {
    candidates.push({
      url: metaImage,
      width: null,
      height: null
    });
  }

  for (const image of Array.from(document.images)) {
    const url = image.currentSrc || image.src;
    if (!url) {
      continue;
    }

    candidates.push({
      url,
      width: image.naturalWidth || image.width || null,
      height: image.naturalHeight || image.height || null
    });
  }

  const seen = new Set<string>();
  const normalized: ThumbnailCandidate[] = [];

  for (const candidate of candidates) {
    if (!/^https?:\/\//i.test(candidate.url) || /\.svg(?:$|\?)/i.test(candidate.url) || seen.has(candidate.url)) {
      continue;
    }

    seen.add(candidate.url);
    normalized.push(candidate);

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function readMetaContent(names: string[]): string | null {
  for (const name of names) {
    const escapedName = cssEscape(name);
    const element = document.querySelector<HTMLMetaElement>(
      `meta[property="${escapedName}"], meta[name="${escapedName}"], meta[itemprop="${escapedName}"]`
    );
    const content = element?.content?.trim();
    if (content) {
      return content;
    }
  }

  return null;
}

function inferStayType(text: string): "entire_apartment" | "private_room" | "shared_room" | "unknown" {
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

  fields[key] =
    findFirstMatch(value, [
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:,?\s+\d{4})?\b/i,
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

function truncateText(value: string | null | undefined, limit: number): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > limit ? normalized.slice(0, limit).trimEnd() : normalized;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/"/g, '\\"');
}

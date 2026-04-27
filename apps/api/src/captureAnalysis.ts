import { createHash } from "node:crypto";

import {
  canonicalizeListingUrl,
  type CleanupAction,
  type GeographyCategory,
  type ListingSource,
  type RiskFlag,
  type StayType
} from "@pamila/core";
import type {
  CaptureRecord,
  UpdateListingInput,
  UpsertLocationInput
} from "@pamila/db";

export interface CaptureCleanupSuggestions {
  inputHash: string;
  suggestedListingUpdate: UpdateListingInput;
  locationSuggestion: UpsertLocationInput | null;
  cleanupActions: CleanupAction[];
  riskFlags: RiskFlag[];
  hostQuestions: string[];
  thumbnailUrl: string | null;
}

export interface OpenAiCaptureAnalysis {
  suggestedListingUpdate?: UpdateListingInput;
  locationSuggestion?: UpsertLocationInput | null;
  cleanupActions?: CleanupAction[];
  riskFlags?: RiskFlag[];
  hostQuestions?: string[];
  summary?: string;
}

export interface OpenAiCaptureOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch | undefined;
}

const MANHATTAN_NEIGHBORHOODS = [
  "chelsea",
  "flatiron",
  "gramercy",
  "union square",
  "nomad",
  "midtown",
  "murray hill",
  "kips bay",
  "east village",
  "west village",
  "greenwich village",
  "soho",
  "tribeca",
  "lower east side",
  "financial district",
  "fidi",
  "upper east side",
  "ues",
  "upper west side",
  "uws",
  "midtown west",
  "hell's kitchen",
  "harlem"
];

const LIC_ASTORIA_NEIGHBORHOODS = ["lic", "long island city", "astoria"];
const BROOKLYN_NEIGHBORHOODS = [
  "williamsburg",
  "greenpoint",
  "dumbo",
  "brooklyn heights",
  "downtown brooklyn",
  "fort greene",
  "clinton hill",
  "park slope",
  "bushwick",
  "bed-stuy",
  "bedford-stuyvesant"
];

export function buildCaptureCleanupSuggestions(capture: CaptureRecord): CaptureCleanupSuggestions {
  const text = combinedCaptureText(capture);
  const lower = text.toLowerCase();
  const suggestedListingUpdate: UpdateListingInput = {};
  const cleanupActions: CleanupAction[] = [];
  const riskFlags: RiskFlag[] = [];
  const hostQuestions: string[] = [];

  const title = capture.capturedTitle?.trim();
  if (title) {
    suggestedListingUpdate.title = title;
  }

  const monthlyRent = parseMonthlyRent(capture.visibleFields, text);
  if (monthlyRent !== null) {
    suggestedListingUpdate.monthlyRent = monthlyRent;
  } else {
    cleanupActions.push(cleanupAction("confirm_monthly_rent", "Confirm advertised monthly rent.", "monthlyRent"));
    hostQuestions.push("Can you confirm the advertised monthly rent and any required fees?");
  }

  const stayType = parseStayType(capture.visibleFields, lower);
  if (stayType !== null) {
    suggestedListingUpdate.stayType = stayType;
  } else {
    cleanupActions.push(cleanupAction("confirm_stay_type", "Confirm whether this is an entire apartment or private room.", "stayType"));
  }

  const bedroom = parseBedroomFromFieldsAndText(capture.visibleFields, text);
  if (bedroom !== null) {
    suggestedListingUpdate.bedroomCount = bedroom.count;
    suggestedListingUpdate.bedroomLabel = bedroom.label;
  } else {
    cleanupActions.push(cleanupAction("confirm_bedroom_count", "Confirm bedroom count.", "bedroomCount"));
  }

  const dateWindow = parseDateWindow(capture.visibleFields, text);
  Object.assign(suggestedListingUpdate, dateWindow.patch);
  cleanupActions.push(...dateWindow.cleanupActions);
  riskFlags.push(...dateWindow.riskFlags);
  hostQuestions.push(...dateWindow.hostQuestions);

  const amenities = parseAmenities(lower);
  Object.assign(suggestedListingUpdate, amenities);

  if (suggestedListingUpdate.kitchen === undefined) {
    cleanupActions.push(cleanupAction("confirm_kitchen", "Confirm kitchen access.", "kitchen"));
  }
  if (suggestedListingUpdate.washer === undefined) {
    cleanupActions.push(cleanupAction("confirm_washer", "Confirm washer access.", "washer"));
  }
  if (suggestedListingUpdate.furnished === undefined) {
    cleanupActions.push(cleanupAction("confirm_furnished", "Confirm whether the listing is furnished.", "furnished"));
  }

  const locationSuggestion = parseLocationSuggestion(capture.source, capture.visibleFields, text);
  if (!locationSuggestion) {
    cleanupActions.push(cleanupAction("confirm_location", "Confirm address, cross streets, or neighborhood.", "location"));
    hostQuestions.push("What is the exact address or nearest cross streets for commute checking?");
  }

  if (capture.source === "leasebreak" && /\b(immediate|available now|asap)\b/i.test(text)) {
    riskFlags.push(riskFlag("leasebreak_immediate_move_in_risk", "Leasebreak listing may prefer immediate move-in.", "warning"));
    hostQuestions.push("Would a June 30 or July 1 move-in be acceptable?");
  }

  suggestedListingUpdate.availabilitySummary = buildAvailabilitySummary(capture.visibleFields, text);
  suggestedListingUpdate.nextAction = cleanupActions.length
    ? "Review imported capture suggestions and confirm missing fields."
    : "Review and decide whether to contact.";

  return {
    cleanupActions: uniqueByCode(cleanupActions),
    hostQuestions: [...new Set(hostQuestions)],
    inputHash: buildCaptureInputHash(capture),
    locationSuggestion,
    riskFlags: uniqueByCode(riskFlags),
    suggestedListingUpdate,
    thumbnailUrl: capture.thumbnailCandidates[0]?.url ?? null
  };
}

export function buildCaptureInputHash(capture: CaptureRecord): string {
  const canonicalUrl = canonicalizeListingUrl(capture.url, capture.source);
  const textHash = capture.pageHash ?? sha256(combinedCaptureText(capture));
  return sha256(`${capture.source}:${canonicalUrl}:${textHash}`);
}

export async function analyzeCaptureWithOpenAI(
  capture: CaptureRecord,
  heuristic: CaptureCleanupSuggestions,
  options: OpenAiCaptureOptions
): Promise<OpenAiCaptureAnalysis> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: [
        {
          content:
            "You extract structured NYC apartment listing facts for PAMILA. Return only fields supported by the provided schema. Do not guess facts that are not visible.",
          role: "system"
        },
        {
          content: JSON.stringify({
            capture: {
              source: capture.source,
              title: capture.capturedTitle,
              url: capture.url,
              visibleFields: capture.visibleFields,
              selectedText: capture.selectedText,
              pageText: trimForModel(capture.capturedText)
            },
            deterministicSuggestions: heuristic
          }),
          role: "user"
        }
      ],
      model: options.model,
      text: {
        format: {
          name: "pamila_capture_analysis",
          schema: openAiAnalysisSchema,
          strict: true,
          type: "json_schema"
        }
      }
    }),
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`OpenAI analysis failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeOpenAiAnalysisPayload(payload);
}

function combinedCaptureText(capture: CaptureRecord) {
  return [
    capture.capturedTitle,
    ...Object.entries(capture.visibleFields).map(([key, value]) => `${key}: ${value}`),
    capture.selectedText,
    capture.capturedText
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .slice(0, 20_000);
}

function parseMonthlyRent(fields: Record<string, string>, text: string): number | null {
  const airbnbCurrentRent = findField(fields, ["airbnb_current_monthly_rent"]);
  if (airbnbCurrentRent) {
    const rent = parseRentFromText(airbnbCurrentRent);
    if (rent !== null) {
      return rent;
    }
  }

  const discountedAirbnbRent = parseDiscountedAirbnbMonthlyRent(text);
  if (discountedAirbnbRent !== null) {
    return discountedAirbnbRent;
  }

  const fieldCandidates = Object.entries(fields)
    .filter(([key]) => /price|rent|monthly|cost/i.test(key) && key !== "airbnb_original_monthly_rent")
    .map(([, value]) => value);

  for (const candidate of [...fieldCandidates, text]) {
    const rent = parseRentFromText(candidate);
    if (rent !== null) {
      return rent;
    }
  }

  return null;
}

function parseDiscountedAirbnbMonthlyRent(input: string): number | null {
  const normalized = input.replace(/\s+/g, " ").trim();
  const matches = normalized.matchAll(
    /\$([1-9][\d,]{2,})\s*(?:(?:monthly|month|\/\s*month|mo\b)\s+)?\$([1-9][\d,]{2,})\s*(?:monthly|month|\/\s*month|mo\b)/gi
  );
  for (const match of matches) {
    const original = parseCurrencyAmount(match[1] ?? "");
    const current = parseCurrencyAmount(match[2] ?? "");
    if (original !== null && current !== null && original > current && current >= 1_000 && current <= 10_000) {
      return current;
    }
  }

  return null;
}

function parseRentFromText(input: string): number | null {
  const matches = input.matchAll(/(?:\$|usd\s*)\s*([1-9][0-9,]{2,})(?:\.\d{2})?/gi);
  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;
    const amount = Number(raw.replaceAll(",", ""));
    const context = input.slice(Math.max(0, match.index - 24), (match.index ?? 0) + match[0].length + 32).toLowerCase();
    const looksMonthly = /month|monthly|mo\.?|rent/.test(context);
    const looksNightly = /night|nightly/.test(context);

    if (Number.isFinite(amount) && amount >= 1000 && amount <= 10_000 && (looksMonthly || !looksNightly)) {
      return amount;
    }
  }

  return null;
}

function parseCurrencyAmount(value: string): number | null {
  const amount = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function parseStayType(fields: Record<string, string>, lowerText: string): StayType | null {
  const candidate = findField(fields, ["stay_type_candidate"]);
  if (candidate === "entire_apartment" || candidate === "private_room" || candidate === "shared_room") {
    return candidate;
  }

  const leasebreakListingType = findField(fields, ["leasebreak_listing_type", "listing_type"]);
  if (leasebreakListingType) {
    const mapped = mapLeasebreakListingTypeToStayType(leasebreakListingType);
    if (mapped !== null) {
      return mapped;
    }
  }

  if (/\bentire_apartment\b/.test(lowerText)) {
    return "entire_apartment";
  }
  if (/\bprivate_room\b/.test(lowerText)) {
    return "private_room";
  }
  if (/\bshared_room\b/.test(lowerText)) {
    return "shared_room";
  }
  if (/\b(shared room|shared bedroom)\b/.test(lowerText)) {
    return "shared_room";
  }
  if (/\b(private room|room in)\b/.test(lowerText)) {
    return "private_room";
  }
  if (/\b(entire|whole)\b.*\b(apartment|apt|home|place|rental unit|unit)\b/.test(lowerText)) {
    return "entire_apartment";
  }
  return null;
}

function mapLeasebreakListingTypeToStayType(listingType: string): StayType | null {
  if (/\bshared\s+(?:room|bedroom)\b/i.test(listingType)) {
    return "shared_room";
  }

  if (/\b(?:private\s+)?rooms?\b|\brooms?\s+for\s+rent\b/i.test(listingType)) {
    return "private_room";
  }

  if (/\b(short\s+term\s+rental|sublet|lease\s+assignment|leasebreak|rental)\b/i.test(listingType)) {
    return "entire_apartment";
  }

  return null;
}

function parseBedroom(text: string): { count: number; label: string } | null {
  return parseBedroomFromFieldsAndText({}, text);
}

function parseBedroomFromFieldsAndText(
  fields: Record<string, string>,
  text: string
): { count: number; label: string } | null {
  const airbnbBedroomCount = findField(fields, ["airbnb_bedroom_count"]);
  if (airbnbBedroomCount) {
    const count = Number(airbnbBedroomCount);
    if (Number.isFinite(count) && count >= 0) {
      return { count, label: count === 0 ? "Studio" : `${count}BR` };
    }
  }

  const leasebreakBedroomCount = findField(fields, ["leasebreak_bedroom_count"]);
  if (leasebreakBedroomCount) {
    const count = Number(leasebreakBedroomCount);
    if (Number.isFinite(count) && count >= 0) {
      return { count, label: count === 0 ? "Studio" : `${count}BR` };
    }
  }

  const bedroomCandidate = findField(fields, ["bedroom_candidate", "airbnb_bedroom_summary"]);
  const focusedText = bedroomCandidate ?? text;
  const lower = text.toLowerCase();
  const focusedLower = focusedText.toLowerCase();
  if (/\bstudio\b/.test(focusedLower) && !/\b\d+(?:\.\d+)?\s*bedrooms?\b/i.test(focusedText)) {
    return { count: 0, label: "Studio" };
  }

  const match =
    /(\d+(?:\.\d+)?)\s*bedrooms?\b/i.exec(focusedText) ??
    /(\d+(?:\.\d+)?)\s*br\b/i.exec(focusedText) ??
    /(\d+(?:\.\d+)?)\s*bed\b/i.exec(focusedText);
  if (!match?.[1]) {
    return null;
  }

  const count = Number(match[1]);
  if (!Number.isFinite(count)) {
    return null;
  }

  return { count, label: `${count}BR` };
}

function parseDateWindow(fields: Record<string, string>, text: string): {
  patch: UpdateListingInput;
  cleanupActions: CleanupAction[];
  riskFlags: RiskFlag[];
  hostQuestions: string[];
} {
  const patch: UpdateListingInput = {};
  const cleanupActions: CleanupAction[] = [];
  const riskFlags: RiskFlag[] = [];
  const hostQuestions: string[] = [];
  const fieldEntries = Object.entries(fields);

  for (const [key, value] of fieldEntries) {
    const lowerKey = key.toLowerCase();
    const parsedDate = parseDate(value);
    if (!parsedDate) continue;

    if (lowerKey.includes("earliest") && lowerKey.includes("move") && lowerKey.includes("in")) {
      patch.earliestMoveIn = parsedDate;
    } else if (lowerKey.includes("latest") && lowerKey.includes("move") && lowerKey.includes("in")) {
      patch.latestMoveIn = parsedDate;
    } else if (lowerKey.includes("earliest") && lowerKey.includes("move") && lowerKey.includes("out")) {
      patch.earliestMoveOut = parsedDate;
    } else if (lowerKey.includes("latest") && lowerKey.includes("move") && lowerKey.includes("out")) {
      patch.latestMoveOut = parsedDate;
    }
  }

  const lowerText = text.toLowerCase();
  if (patch.earliestMoveIn === undefined && /\b(6\/30|june 30|jun 30)\b/i.test(text)) {
    patch.earliestMoveIn = "2026-06-30";
  }
  if (patch.earliestMoveIn === undefined && /\b(7\/1|july 1|jul 1)\b/i.test(text)) {
    patch.earliestMoveIn = "2026-07-01";
  }
  if (patch.latestMoveOut === undefined && /\b(9\/12|september 12|sep 12|sept 12)\b/i.test(text)) {
    patch.latestMoveOut = "2026-09-12";
  }
  if (/\bmonth[-\s]?to[-\s]?month\b/.test(lowerText)) {
    patch.monthToMonth = true;
    riskFlags.push(riskFlag("month_to_month_uncertain", "Month-to-month listing needs full-stay confirmation.", "warning"));
    hostQuestions.push("Can month-to-month terms cover the full stay through September 12?");
  }

  if (patch.earliestMoveIn === undefined && patch.latestMoveIn === undefined) {
    cleanupActions.push(cleanupAction("confirm_move_in", "Confirm June 30 or July 1 move-in is accepted.", "dateWindow"));
    hostQuestions.push("Would a June 30 or July 1 move-in work?");
  }
  if (patch.latestMoveOut === undefined && patch.monthToMonth !== true) {
    cleanupActions.push(cleanupAction("confirm_move_out", "Confirm September 12 move-out is accepted.", "dateWindow"));
    hostQuestions.push("Would a September 12 move-out work?");
  }

  return { cleanupActions, hostQuestions, patch, riskFlags };
}

function parseDate(input: string): string | null {
  const isoMatch = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(input);
  if (isoMatch?.[1] && isoMatch[2] && isoMatch[3]) {
    return isoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/.exec(input);
  if (slashMatch?.[1] && slashMatch[2]) {
    return isoDate(Number(slashMatch[3] ?? "2026"), Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const monthMatch = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i.exec(input);
  if (monthMatch?.[1] && monthMatch[2]) {
    return isoDate(Number(monthMatch[3] ?? "2026"), monthNumber(monthMatch[1]), Number(monthMatch[2]));
  }

  return null;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(month: string): number {
  const normalized = month.slice(0, 3).toLowerCase();
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(normalized) + 1;
}

function parseAmenities(lowerText: string): UpdateListingInput {
  const patch: UpdateListingInput = {};

  if (/\b(no kitchen|kitchenette only)\b/.test(lowerText)) {
    patch.kitchen = "no";
  } else if (/\bkitchen\b/.test(lowerText)) {
    patch.kitchen = "yes";
  }

  if (/\b(no washer|no laundry)\b/.test(lowerText)) {
    patch.washer = "no";
  } else if (/\b(in[-\s]?unit washer|washer\/dryer|w\/d|laundry in unit)\b/.test(lowerText)) {
    patch.washer = "in_unit";
  } else if (/\b(laundry in building|washer in building|building laundry)\b/.test(lowerText)) {
    patch.washer = "in_building";
  } else if (/\b(laundromat|nearby laundry|laundry nearby)\b/.test(lowerText)) {
    patch.washer = "nearby";
  }

  if (/\bunfurnished\b/.test(lowerText)) {
    patch.furnished = "no";
  } else if (/\bfurnished\b/.test(lowerText)) {
    patch.furnished = "yes";
  }

  if (/\bshared bathroom\b/.test(lowerText)) {
    patch.bathroomType = "shared";
  } else if (/\b(private bathroom|1 bath|1 bathroom|bathroom)\b/.test(lowerText)) {
    patch.bathroomType = "private";
  }

  return patch;
}

function parseLocationSuggestion(
  source: ListingSource,
  fields: Record<string, string>,
  text: string
): UpsertLocationInput | null {
  const airbnbLocation = parseAirbnbLocationSuggestion(fields);
  if (airbnbLocation) {
    return airbnbLocation;
  }

  if (source === "leasebreak") {
    const leasebreakLocation = parseLeasebreakLocationSuggestion(fields, text);
    if (leasebreakLocation) {
      return leasebreakLocation;
    }
  }

  const locationField = findField(fields, ["address", "location", "neighborhood", "cross"]);
  const neighborhood = detectNeighborhood(`${locationField ?? ""}\n${text}`);
  const lowerLocation = locationField?.toLowerCase() ?? "";
  const hasCrossStreets = /\b(?:and|&|\/)\b/.test(lowerLocation) && /\b(st|street|ave|avenue|broadway|blvd|road|rd)\b/.test(lowerLocation);
  const hasAddressNumber = /\b\d{1,5}\s+[a-z0-9 .'-]+(?:st|street|ave|avenue|broadway|blvd|road|rd)\b/i.test(locationField ?? "");

  if (hasAddressNumber && locationField) {
    return {
      address: locationField,
      confidence: "high",
      geographyCategory: geographyForLocation(locationField, neighborhood),
      isUserConfirmed: false,
      label: locationField,
      neighborhood,
      source: "exact_address"
    };
  }

  if (hasCrossStreets && locationField) {
    return {
      confidence: "medium",
      crossStreets: locationField,
      geographyCategory: geographyForLocation(locationField, neighborhood),
      isUserConfirmed: false,
      label: locationField,
      neighborhood,
      source: "cross_streets"
    };
  }

  if (neighborhood) {
    return {
      confidence: source === "airbnb" ? "low" : "medium",
      geographyCategory: geographyForLocation(neighborhood, neighborhood),
      isUserConfirmed: false,
      label: neighborhood,
      neighborhood,
      source: source === "airbnb" ? "airbnb_approx_pin" : "neighborhood"
    };
  }

  return null;
}

function parseLeasebreakLocationSuggestion(fields: Record<string, string>, text: string): UpsertLocationInput | null {
  const explicitAddress =
    exactField(fields, "leasebreak_address") ??
    exactField(fields, "address") ??
    exactField(fields, "location_candidate") ??
    extractStreetAddress(text);
  const neighborhood = detectNeighborhood(
    [
      exactField(fields, "leasebreak_neighborhood"),
      exactField(fields, "neighborhood_candidate"),
      explicitAddress,
      text
    ]
      .filter(Boolean)
      .join("\n")
  );

  if (explicitAddress) {
    return {
      address: normalizeNycAddress(explicitAddress),
      confidence: "exact",
      geographyCategory: geographyForLocation(explicitAddress, neighborhood),
      isUserConfirmed: false,
      label: explicitAddress,
      neighborhood,
      source: "exact_address"
    };
  }

  const neighborhoodField = exactField(fields, "leasebreak_neighborhood") ?? exactField(fields, "neighborhood_candidate");
  const label = neighborhood ?? neighborhoodField;
  if (label) {
    return {
      confidence: "medium",
      geographyCategory: geographyForLocation(label, neighborhood),
      isUserConfirmed: false,
      label,
      neighborhood: neighborhood ?? label,
      source: "neighborhood"
    };
  }

  return null;
}

function parseAirbnbLocationSuggestion(fields: Record<string, string>): UpsertLocationInput | null {
  const label = findField(fields, ["airbnb_location_label"]);
  const lat = parseNumberField(fields.airbnb_approx_lat);
  const lng = parseNumberField(fields.airbnb_approx_lng);
  const inferredNeighborhood = lat !== null && lng !== null ? inferNycNeighborhoodFromCoordinates(lat, lng) : null;
  const neighborhood = detectNeighborhood([label, inferredNeighborhood].filter(Boolean).join("\n")) ?? inferredNeighborhood;
  const usableLabel = neighborhood ?? (label && !isGenericAirbnbLocationLabel(label) ? label : null);

  if (!usableLabel && lat === null && lng === null) {
    return null;
  }

  const finalLabel = usableLabel ?? "Airbnb approximate location";
  return {
    confidence: lat !== null && lng !== null ? "medium" : "low",
    geographyCategory: geographyForLocation(finalLabel, neighborhood),
    isUserConfirmed: false,
    label: finalLabel,
    lat,
    lng,
    neighborhood,
    source: "airbnb_approx_pin"
  };
}

function parseNumberField(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isGenericAirbnbLocationLabel(label: string) {
  return /^(new york|new york, united states|nyc|united states)$/i.test(label.trim());
}

function exactField(fields: Record<string, string>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractStreetAddress(text: string): string | null {
  const match = text.match(/\b\d{1,5}\s+[A-Z0-9][A-Za-z0-9 .'-]{1,80}?\s(?:st|street|ave|avenue|broadway|blvd|boulevard|rd|road)\b/i);
  return match?.[0] ? normalizeAddressLabel(match[0]) : null;
}

function normalizeAddressLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNycAddress(value: string): string {
  const normalized = normalizeAddressLabel(value);
  return /new york|nyc|brooklyn|queens/i.test(normalized) ? normalized : `${normalized}, New York, NY`;
}

function findField(fields: Record<string, string>, keys: string[]): string | null {
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (keys.some((candidate) => lowerKey.includes(candidate)) && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function detectNeighborhood(text: string): string | null {
  const lower = text.toLowerCase();
  const canonicalNeighborhoods: Array<[RegExp, string]> = [
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
  for (const [pattern, label] of canonicalNeighborhoods) {
    if (pattern.test(lower)) {
      return label;
    }
  }

  const neighborhoods = [...MANHATTAN_NEIGHBORHOODS, ...LIC_ASTORIA_NEIGHBORHOODS, ...BROOKLYN_NEIGHBORHOODS];
  return neighborhoods.find((neighborhood) => lower.includes(neighborhood)) ?? null;
}

function inferNycNeighborhoodFromCoordinates(lat: number, lng: number): string | null {
  const boxes: Array<{ label: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
    { label: "Upper West Side", minLat: 40.765, maxLat: 40.805, minLng: -73.995, maxLng: -73.955 },
    { label: "Upper East Side", minLat: 40.758, maxLat: 40.79, minLng: -73.97, maxLng: -73.935 },
    { label: "Chelsea", minLat: 40.735, maxLat: 40.755, minLng: -74.01, maxLng: -73.99 },
    { label: "Flatiron", minLat: 40.735, maxLat: 40.747, minLng: -73.997, maxLng: -73.985 },
    { label: "Astoria", minLat: 40.755, maxLat: 40.79, minLng: -73.94, maxLng: -73.895 },
    { label: "Long Island City", minLat: 40.735, maxLat: 40.765, minLng: -73.965, maxLng: -73.925 },
    { label: "Williamsburg", minLat: 40.7, maxLat: 40.73, minLng: -73.97, maxLng: -73.93 },
    { label: "Greenpoint", minLat: 40.725, maxLat: 40.745, minLng: -73.965, maxLng: -73.93 }
  ];

  return boxes.find((box) => lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng)?.label ?? null;
}

function geographyForLocation(locationText: string, neighborhood: string | null): GeographyCategory {
  const lower = `${locationText} ${neighborhood ?? ""}`.toLowerCase();
  if (MANHATTAN_NEIGHBORHOODS.some((name) => lower.includes(name)) || lower.includes("manhattan")) {
    return "manhattan";
  }
  if (LIC_ASTORIA_NEIGHBORHOODS.some((name) => lower.includes(name)) || lower.includes("queens")) {
    return "lic_astoria";
  }
  if (BROOKLYN_NEIGHBORHOODS.some((name) => lower.includes(name)) || lower.includes("brooklyn")) {
    return "brooklyn";
  }
  return "unknown";
}

function buildAvailabilitySummary(fields: Record<string, string>, text: string): string | null {
  const leasebreakAvailability = buildLeasebreakAvailabilitySummary(fields);
  if (leasebreakAvailability) {
    return leasebreakAvailability;
  }

  const capturedAvailability = findField(fields, [
    "airbnb_availability_summary",
    "availability_summary_candidate",
    "availability_candidate"
  ]);
  if (capturedAvailability) {
    return normalizeAvailabilitySummary(capturedAvailability);
  }

  const dateRange = extractAvailabilityDateRange(text);
  if (dateRange) {
    return dateRange;
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const availabilityLine = lines.find((line) => {
    if (isNoisyAvailabilityLine(line)) {
      return false;
    }
    return /available|availability|move|lease|month-to-month|immediate/i.test(line);
  });
  return availabilityLine ? normalizeAvailabilitySummary(availabilityLine) : null;
}

function buildLeasebreakAvailabilitySummary(fields: Record<string, string>): string | null {
  const earliestMoveIn = exactField(fields, "earliest_move_in_candidate");
  const latestMoveIn = exactField(fields, "latest_move_in_candidate");
  const earliestMoveOut = exactField(fields, "earliest_move_out_candidate");
  const latestMoveOut = exactField(fields, "latest_move_out_candidate");
  const moveInUrgency = exactField(fields, "move_in_urgency_candidate");
  const parts: string[] = [];

  if (earliestMoveIn) {
    parts.push(`Earliest move-in: ${earliestMoveIn}`);
  } else if (moveInUrgency && /\bimmediate\b/i.test(moveInUrgency)) {
    parts.push("Immediate move-in listed");
  }
  if (latestMoveIn) {
    parts.push(`Latest move-in: ${latestMoveIn}`);
  }
  if (earliestMoveOut) {
    parts.push(`Earliest move-out: ${earliestMoveOut}`);
  }
  if (latestMoveOut) {
    parts.push(`Latest move-out: ${latestMoveOut}`);
  }

  return parts.length > 0 ? normalizeAvailabilitySummary(parts.join("; ")) : null;
}

function extractAvailabilityDateRange(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const monthRange = normalized.match(
    /\b((?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+\d{1,2},\s+\d{4})\s*[-–]\s*((?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+\d{1,2},\s+\d{4})\b/i
  );
  if (monthRange?.[1] && monthRange[2]) {
    return `Available ${monthRange[1]} to ${monthRange[2]}`;
  }

  const checkInOut = normalized.match(
    /\bcheck-?in\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+check-?out\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i
  );
  return checkInOut?.[1] && checkInOut[2] ? `Available ${checkInOut[1]} to ${checkInOut[2]}` : null;
}

function normalizeAvailabilitySummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function isNoisyAvailabilityLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    line.length > 240 ||
    lower.startsWith("skip to content") ||
    lower.includes("leasebreak.com") ||
    lower.includes("homes homes") ||
    lower.includes("experiences experiences") ||
    lower.includes("start your search")
  );
}

function normalizeOpenAiAnalysisPayload(payload: Record<string, unknown>): OpenAiCaptureAnalysis {
  const outputText = extractOutputText(payload);
  if (!outputText) {
    return {};
  }

  try {
    const parsed = JSON.parse(outputText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as OpenAiCaptureAnalysis)
      : {};
  } catch {
    return {};
  }
}

function extractOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const text = (contentItem as { text?: unknown }).text;
      if (typeof text === "string") {
        return text;
      }
    }
  }

  return null;
}

function trimForModel(input: string | null) {
  return input?.slice(0, 16_000) ?? null;
}

function cleanupAction(code: string, label: string, field?: string): CleanupAction {
  return field === undefined ? { code, label } : { code, label, field };
}

function riskFlag(code: string, label: string, severity: RiskFlag["severity"]): RiskFlag {
  return { code, label, severity };
}

function uniqueByCode<T extends { code: string }>(items: T[]) {
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

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

const openAiAnalysisSchema = {
  additionalProperties: false,
  properties: {
    cleanupActions: {
      items: {
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          field: { type: ["string", "null"] },
          label: { type: "string" }
        },
        required: ["code", "label", "field"],
        type: "object"
      },
      type: "array"
    },
    hostQuestions: { items: { type: "string" }, type: "array" },
    locationSuggestion: {
      additionalProperties: false,
      properties: {
        address: { type: ["string", "null"] },
        confidence: { enum: ["exact", "high", "medium", "low"] },
        crossStreets: { type: ["string", "null"] },
        geographyCategory: { enum: ["manhattan", "lic_astoria", "brooklyn", "other", "unknown"] },
        isUserConfirmed: { type: "boolean" },
        label: { type: ["string", "null"] },
        lat: { type: ["number", "null"] },
        lng: { type: ["number", "null"] },
        neighborhood: { type: ["string", "null"] },
        source: { enum: ["exact_address", "cross_streets", "airbnb_approx_pin", "neighborhood", "manual_guess"] }
      },
      required: ["label", "address", "crossStreets", "neighborhood", "geographyCategory", "lat", "lng", "source", "confidence", "isUserConfirmed"],
      type: ["object", "null"]
    },
    riskFlags: {
      items: {
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          label: { type: "string" },
          severity: { enum: ["info", "warning", "critical"] }
        },
        required: ["code", "label", "severity"],
        type: "object"
      },
      type: "array"
    },
    suggestedListingUpdate: {
      additionalProperties: false,
      properties: {
        availabilitySummary: { type: ["string", "null"] },
        bathroomType: { enum: ["private", "shared", "unknown", null] },
        bedroomCount: { type: ["number", "null"] },
        bedroomLabel: { type: ["string", "null"] },
        earliestMoveIn: { type: ["string", "null"] },
        earliestMoveOut: { type: ["string", "null"] },
        furnished: { enum: ["yes", "no", "unknown", null] },
        kitchen: { enum: ["yes", "no", "unknown", null] },
        latestMoveIn: { type: ["string", "null"] },
        latestMoveOut: { type: ["string", "null"] },
        monthToMonth: { type: ["boolean", "null"] },
        monthlyRent: { type: ["number", "null"] },
        nextAction: { type: ["string", "null"] },
        stayType: { enum: ["entire_apartment", "private_room", "shared_room", "unknown", null] },
        title: { type: ["string", "null"] },
        washer: { enum: ["in_unit", "in_building", "nearby", "no", "unknown", null] }
      },
      required: [
        "availabilitySummary",
        "bathroomType",
        "bedroomCount",
        "bedroomLabel",
        "earliestMoveIn",
        "earliestMoveOut",
        "furnished",
        "kitchen",
        "latestMoveIn",
        "latestMoveOut",
        "monthToMonth",
        "monthlyRent",
        "nextAction",
        "stayType",
        "title",
        "washer"
      ],
      type: "object"
    },
    summary: { type: ["string", "null"] }
  },
  required: ["suggestedListingUpdate", "locationSuggestion", "cleanupActions", "riskFlags", "hostQuestions", "summary"],
  type: "object"
} as const;

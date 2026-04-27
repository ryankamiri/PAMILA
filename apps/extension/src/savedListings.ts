import type { ApiSavedListingMatch, CaptureImportApiResponse } from "./apiClient.js";
import type { SavedListingSnapshot } from "./captureContract.js";

export const SAVED_LISTINGS_STORAGE_KEY = "pamilaSavedListingsByCanonicalUrl";

export type SavedListingsCache = Record<string, SavedListingSnapshot>;
export type SavedListingSource = "airbnb" | "leasebreak";

export function canonicalizeExtensionListingUrl(url: string, source?: SavedListingSource): string {
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

export function mergeApiMatchesIntoSavedListingsCache(
  cache: SavedListingsCache,
  matches: Record<string, ApiSavedListingMatch>,
  confirmedAt: string
): SavedListingsCache {
  const nextCache = { ...cache };

  for (const [canonicalUrl, match] of Object.entries(matches)) {
    const previous = nextCache[canonicalUrl];
    nextCache[canonicalUrl] = {
      canonicalUrl,
      lastConfirmedAt: confirmedAt,
      listingId: match.listingId,
      savedAt: previous?.savedAt ?? confirmedAt,
      sourceUrl: match.sourceUrl,
      status: match.status,
      title: match.title
    };
  }

  return nextCache;
}

export function removeLookupMissesFromSavedListingsCache(
  cache: SavedListingsCache,
  urls: string[],
  matches: Record<string, ApiSavedListingMatch>,
  source?: SavedListingSource
): SavedListingsCache {
  const nextCache = { ...cache };
  const matchedUrls = new Set(Object.keys(matches));

  for (const url of urls) {
    const canonicalUrl = canonicalizeExtensionListingUrl(url, source);
    if (!matchedUrls.has(canonicalUrl)) {
      delete nextCache[canonicalUrl];
    }
  }

  return nextCache;
}

export function buildSavedListingMatchesByUrl(
  urls: string[],
  cache: SavedListingsCache,
  lookupSource: "api" | "cache",
  source?: SavedListingSource
): Record<string, SavedListingSnapshot> {
  const matchesByUrl: Record<string, SavedListingSnapshot> = {};

  for (const url of urls) {
    const canonicalUrl = canonicalizeExtensionListingUrl(url, source);
    const match = cache[canonicalUrl];
    if (!match) {
      continue;
    }

    matchesByUrl[url] = {
      ...match,
      lookupSource
    };
  }

  return matchesByUrl;
}

export function savedListingFromCaptureImport(
  response: CaptureImportApiResponse,
  fallbackUrl: string,
  confirmedAt: string,
  source?: SavedListingSource
): SavedListingSnapshot {
  const canonicalUrl =
    response.listing.canonicalSourceUrl ?? canonicalizeExtensionListingUrl(response.listing.sourceUrl || fallbackUrl, source);

  return {
    canonicalUrl,
    lastConfirmedAt: confirmedAt,
    listingId: response.listing.id,
    savedAt: confirmedAt,
    sourceUrl: response.listing.sourceUrl || fallbackUrl,
    status: response.listing.status,
    title: response.listing.title
  };
}

function inferSourceFromUrl(parsedUrl: URL): SavedListingSource | null {
  const hostname = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
  if (hostname.endsWith("airbnb.com")) {
    return "airbnb";
  }
  if (hostname.endsWith("leasebreak.com")) {
    return "leasebreak";
  }
  return null;
}

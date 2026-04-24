import type { ListingSource } from "@pamila/core";

export type ExtensionPageStatus = "listing_page" | "search_page" | "unsupported_page";

export interface ClassifiedExtensionPage {
  source: ListingSource | null;
  status: ExtensionPageStatus;
}

export function classifyExtensionPage(url: string): ClassifiedExtensionPage {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return {
      source: null,
      status: "unsupported_page"
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (hostname === "airbnb.com" || hostname.endsWith(".airbnb.com")) {
    return {
      source: "airbnb",
      status: isAirbnbListingPath(pathname) ? "listing_page" : "search_page"
    };
  }

  if (hostname === "leasebreak.com" || hostname.endsWith(".leasebreak.com")) {
    return {
      source: "leasebreak",
      status: isLeasebreakListingPath(pathname) ? "listing_page" : "search_page"
    };
  }

  return {
    source: null,
    status: "unsupported_page"
  };
}

function isAirbnbListingPath(pathname: string): boolean {
  return /^\/rooms\/\d+(?:$|[/?#])/.test(pathname) || /^\/luxury\/listing\//.test(pathname);
}

function isLeasebreakListingPath(pathname: string): boolean {
  return pathname.includes("/short-term-rental-details/") || pathname.includes("/rental-details/");
}

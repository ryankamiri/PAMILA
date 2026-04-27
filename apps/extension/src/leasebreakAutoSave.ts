import type { ExtensionSettings, SavedListingSnapshot } from "./captureContract.js";
import type { ClassifiedExtensionPage } from "./pageClassifier.js";
import { canonicalizeExtensionListingUrl } from "./savedListings.js";

export interface LeasebreakAutoSaveDecisionInput {
  allowAutoSaveCurrentPage: boolean;
  alreadyAttempted: boolean;
  currentTabUrl: string | null;
  matchesByUrl: Record<string, SavedListingSnapshot>;
  page: ClassifiedExtensionPage;
  requestedUrls: string[];
  settings: Pick<ExtensionSettings, "autoSaveLeasebreakListings">;
}

export interface LeasebreakAutoSaveDecision {
  canonicalUrl: string | null;
  reason:
    | "eligible"
    | "disabled"
    | "not_allowed"
    | "not_leasebreak_listing"
    | "invalid_request"
    | "already_saved"
    | "already_attempted";
  shouldAutoSave: boolean;
}

export function decideLeasebreakAutoSave(input: LeasebreakAutoSaveDecisionInput): LeasebreakAutoSaveDecision {
  if (!input.settings.autoSaveLeasebreakListings) {
    return blocked("disabled");
  }

  if (!input.allowAutoSaveCurrentPage) {
    return blocked("not_allowed");
  }

  if (input.page.source !== "leasebreak" || input.page.status !== "listing_page") {
    return blocked("not_leasebreak_listing");
  }

  if (!input.currentTabUrl || input.requestedUrls.length !== 1) {
    return blocked("invalid_request");
  }

  const requestedCanonicalUrl = canonicalizeExtensionListingUrl(input.requestedUrls[0] ?? "", "leasebreak");
  const tabCanonicalUrl = canonicalizeExtensionListingUrl(input.currentTabUrl, "leasebreak");
  if (!requestedCanonicalUrl || requestedCanonicalUrl !== tabCanonicalUrl) {
    return blocked("invalid_request");
  }

  const alreadySaved = Object.values(input.matchesByUrl).some(
    (match) => match.canonicalUrl === requestedCanonicalUrl || canonicalizeExtensionListingUrl(match.sourceUrl, "leasebreak") === requestedCanonicalUrl
  );
  if (alreadySaved) {
    return blocked("already_saved", requestedCanonicalUrl);
  }

  if (input.alreadyAttempted) {
    return blocked("already_attempted", requestedCanonicalUrl);
  }

  return {
    canonicalUrl: requestedCanonicalUrl,
    reason: "eligible",
    shouldAutoSave: true
  };
}

function blocked(reason: LeasebreakAutoSaveDecision["reason"], canonicalUrl: string | null = null): LeasebreakAutoSaveDecision {
  return {
    canonicalUrl,
    reason,
    shouldAutoSave: false
  };
}

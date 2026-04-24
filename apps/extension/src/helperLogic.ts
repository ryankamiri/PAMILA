import type { ApiConnectionStatus } from "./captureContract.js";
import type { ClassifiedExtensionPage } from "./pageClassifier.js";

export interface HelperViewModel {
  apiStatusLabel: string;
  pageStatusLabel: string;
  canSaveListing: boolean;
  primaryActionLabel: string;
  quickSaveAction: "save" | "open_helper" | "disabled" | null;
  quickSaveLabel: string | null;
  quickSaveVisible: boolean;
  guidanceTitle: string;
  guidanceBullets: string[];
}

export type HelperSaveStatus = "idle" | "saving" | "saved" | "error";

export function buildHelperViewModel(
  page: ClassifiedExtensionPage,
  apiStatus: ApiConnectionStatus | "checking",
  saveStatus: HelperSaveStatus = "idle"
): HelperViewModel {
  const pageStatusLabel = getPageStatusLabel(page.status);

  if (page.status === "listing_page") {
    return {
      apiStatusLabel: getApiStatusLabel(apiStatus),
      pageStatusLabel,
      canSaveListing: true,
      primaryActionLabel: "Save this listing to PAMILA",
      quickSaveAction: getQuickSaveAction(apiStatus, saveStatus),
      quickSaveLabel: getQuickSaveLabel(apiStatus, saveStatus),
      quickSaveVisible: true,
      guidanceTitle: "Ready to save",
      guidanceBullets: [
        "Save only the specific listing page you are viewing.",
        "After saving, open PAMILA Inbox to clean up price, dates, stay type, and location.",
        "If the API status is not connected, fix the token or start the local API first."
      ]
    };
  }

  if (page.status === "search_page") {
    return {
      apiStatusLabel: getApiStatusLabel(apiStatus),
      pageStatusLabel,
      canSaveListing: false,
      primaryActionLabel: "Open a listing first",
      quickSaveAction: null,
      quickSaveLabel: null,
      quickSaveVisible: false,
      guidanceTitle: "Search page guidance",
      guidanceBullets: [
        "Open one promising listing page before saving.",
        "Airbnb filters: NYC/Manhattan, Jun 30 or Jul 1 through Sep 12, entire place, max around $3,600 monthly.",
        "Leasebreak date windows matter: earliest/latest move-in and move-out can change ranking.",
        "PAMILA does not batch-capture search cards."
      ]
    };
  }

  return {
    apiStatusLabel: getApiStatusLabel(apiStatus),
    pageStatusLabel,
    canSaveListing: false,
    primaryActionLabel: "Unsupported page",
    quickSaveAction: null,
    quickSaveLabel: null,
    quickSaveVisible: false,
    guidanceTitle: "Unsupported page",
    guidanceBullets: ["PAMILA only captures Airbnb and Leasebreak listing pages."]
  };
}

function getApiStatusLabel(status: ApiConnectionStatus | "checking"): string {
  if (status === "connected") {
    return "Connected";
  }

  if (status === "token_issue") {
    return "Token issue";
  }

  if (status === "api_offline") {
    return "API offline";
  }

  return "Checking";
}

function getPageStatusLabel(status: ClassifiedExtensionPage["status"]): string {
  if (status === "listing_page") {
    return "Listing page";
  }

  if (status === "search_page") {
    return "Search page";
  }

  return "Unsupported page";
}

function getQuickSaveAction(
  apiStatus: ApiConnectionStatus | "checking",
  saveStatus: HelperSaveStatus
): HelperViewModel["quickSaveAction"] {
  if (saveStatus === "saving" || saveStatus === "saved" || apiStatus === "checking") {
    return "disabled";
  }

  if (apiStatus === "api_offline" || apiStatus === "token_issue") {
    return "open_helper";
  }

  return "save";
}

function getQuickSaveLabel(apiStatus: ApiConnectionStatus | "checking", saveStatus: HelperSaveStatus): string {
  if (saveStatus === "saving") {
    return "Saving...";
  }

  if (saveStatus === "saved") {
    return "Saved to PAMILA";
  }

  if (saveStatus === "error") {
    return "Save failed";
  }

  if (apiStatus === "api_offline") {
    return "API offline";
  }

  if (apiStatus === "token_issue") {
    return "Fix token";
  }

  if (apiStatus === "checking") {
    return "Checking...";
  }

  return "Save to PAMILA";
}

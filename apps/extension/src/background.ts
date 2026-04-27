import {
  CAPTURE_MESSAGE_TYPE,
  EXTENSION_DISPLAY_NAME,
  HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE,
  HELPER_CHECK_CONNECTION_MESSAGE_TYPE,
  HELPER_LOOKUP_LISTINGS_MESSAGE_TYPE,
  type CaptureResponseMessage,
  type HelperCaptureResult,
  type SavedListingLookupMessage,
  type SavedListingLookupResult,
  type SavedListingSnapshot
} from "./captureContract.js";
import { checkApiConnection, lookupSavedListings, postCapturePayload } from "./apiClient.js";
import { classifyExtensionPage } from "./pageClassifier.js";
import { decideLeasebreakAutoSave } from "./leasebreakAutoSave.js";
import {
  SAVED_LISTINGS_STORAGE_KEY,
  buildSavedListingMatchesByUrl,
  canonicalizeExtensionListingUrl,
  mergeApiMatchesIntoSavedListingsCache,
  removeLookupMissesFromSavedListingsCache,
  savedListingFromCaptureImport,
  type SavedListingsCache,
  type SavedListingSource
} from "./savedListings.js";
import { loadExtensionSettings } from "./settings.js";

const LEASEBREAK_AUTO_SAVE_ATTEMPTS_STORAGE_KEY = "pamilaLeasebreakAutoSaveAttemptsByCanonicalUrl";

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${EXTENSION_DISPLAY_NAME} installed.`);
});

chrome.action.onClicked.addListener((tab) => {
  void captureActiveTab(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === HELPER_CHECK_CONNECTION_MESSAGE_TYPE) {
    void handleConnectionCheck().then(sendResponse).catch((error: unknown) => {
      sendResponse({
        status: "api_offline",
        message: error instanceof Error ? error.message : "PAMILA connection check failed."
      });
    });
    return true;
  }

  if (message?.type === HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE) {
    void handleHelperCapture(sender.tab).then(sendResponse).catch((error: unknown) => {
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "PAMILA capture failed before it reached the API.",
        apiStatus: "api_offline"
      });
    });
    return true;
  }

  if (message?.type === HELPER_LOOKUP_LISTINGS_MESSAGE_TYPE) {
    void handleSavedListingLookup(message, sender.tab).then(sendResponse).catch((error: unknown) => {
      sendResponse({
        apiStatus: "api_offline",
        cacheOnly: true,
        matchesByUrl: {},
        message: error instanceof Error ? error.message : "Saved-listing lookup failed."
      });
    });
    return true;
  }

  return false;
});

async function captureActiveTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.url) {
    await showBadge("ERR", "#9f1239");
    console.warn("PAMILA capture failed: no active tab URL.");
    return;
  }

  const page = classifyExtensionPage(tab.url);
  if (page.status !== "listing_page") {
    await showBadge("NO", "#92400e");
    console.warn("PAMILA capture skipped: open a specific Airbnb or Leasebreak listing first.", tab.url);
    return;
  }

  try {
    const settings = await loadExtensionSettings();
    const response = await requestCapture(tab.id, settings);

    if (!response.ok) {
      throw new Error(response.error);
    }

    const imported = await postCapturePayload(settings, response.payload);
    await rememberSavedListing(
      savedListingFromCaptureImport(imported, response.payload.url, new Date().toISOString(), response.payload.source)
    );
    await showBadge("OK", "#166534");
  } catch (error) {
    await showBadge("ERR", "#9f1239");
    console.error("PAMILA capture failed.", error);
  }
}

async function handleHelperCapture(tab: chrome.tabs.Tab | undefined): Promise<HelperCaptureResult> {
  const settings = await loadExtensionSettings();
  const connection = await checkApiConnection(settings);

  if (!tab?.id || !tab.url) {
    return {
      ok: false,
      message: "PAMILA could not read the active tab.",
      apiStatus: connection.status
    };
  }

  const page = classifyExtensionPage(tab.url);
  if (page.status === "search_page") {
    await showBadge("OPEN", "#92400e");
    return {
      ok: false,
      message: "Open a specific listing page before saving. Search pages are only for browsing.",
      apiStatus: connection.status
    };
  }

  if (page.status !== "listing_page") {
    await showBadge("NO", "#92400e");
    return {
      ok: false,
      message: "PAMILA only captures Airbnb and Leasebreak listing pages.",
      apiStatus: connection.status
    };
  }

  try {
    const response = await requestCapture(tab.id, settings);
    if (!response.ok) {
      throw new Error(response.error);
    }

    const imported = await postCapturePayload(settings, response.payload);
    const savedListing = savedListingFromCaptureImport(
      imported,
      response.payload.url,
      new Date().toISOString(),
      response.payload.source
    );
    await rememberSavedListing(savedListing);
    await showBadge("OK", "#166534");

    return {
      ok: true,
      ...(imported.appliedCorrections ? { appliedCorrections: imported.appliedCorrections } : {}),
      ...(imported.correctionMode ? { correctionMode: imported.correctionMode } : {}),
      message: formatCaptureImportMessage(imported),
      apiStatus: "connected",
      savedListing: {
        ...savedListing,
        lookupSource: "api"
      }
    };
  } catch (error) {
    const refreshedConnection = await checkApiConnection(settings);
    await showBadge("ERR", "#9f1239");

    return {
      ok: false,
      message: error instanceof Error ? error.message : "PAMILA capture failed.",
      apiStatus: refreshedConnection.status
    };
  }
}

function formatCaptureImportMessage(imported: Awaited<ReturnType<typeof postCapturePayload>>) {
  const corrections = imported.appliedCorrections ?? [];
  if (imported.correctionMode === "auto_fixed" && corrections.length > 0) {
    return `Updated ${formatCorrectionList(corrections)}.`;
  }
  if (imported.correctionMode === "filled_missing" && corrections.length > 0) {
    return `Filled ${formatCorrectionList(corrections)}.`;
  }
  if (imported.correctionMode === "no_changes") {
    return "PAMILA facts are already up to date.";
  }
  return "Saved to PAMILA Inbox.";
}

function formatCorrectionList(corrections: NonNullable<Awaited<ReturnType<typeof postCapturePayload>>["appliedCorrections"]>) {
  return corrections
    .slice(0, 4)
    .map((correction) => `${labelize(correction.field)} to ${formatCorrectionValue(correction.field, correction.nextValue)}`)
    .join(", ");
}

function formatCorrectionValue(field: string, value: unknown) {
  if (typeof value === "number" && field === "monthlyRent") {
    return `$${value.toLocaleString("en-US")}`;
  }

  return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
}

function labelize(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

async function handleConnectionCheck(): Promise<Awaited<ReturnType<typeof checkApiConnection>>> {
  const settings = await loadExtensionSettings();
  return await checkApiConnection(settings);
}

async function handleSavedListingLookup(
  message: SavedListingLookupMessage,
  tab: chrome.tabs.Tab | undefined
): Promise<SavedListingLookupResult> {
  const urls = normalizeLookupUrls(message.urls);
  const source = normalizeLookupSource(message.source);
  const settings = await loadExtensionSettings();
  const cachedMatches = async (apiStatus: SavedListingLookupResult["apiStatus"], messageText: string) => ({
    apiStatus,
    cacheOnly: true,
    matchesByUrl: buildSavedListingMatchesByUrl(urls, await loadSavedListingsCache(), "cache", source),
    message: messageText
  });

  if (urls.length === 0) {
    return {
      apiStatus: "api_offline",
      cacheOnly: true,
      matchesByUrl: {},
      message: "No listing URLs were found on this page."
    };
  }

  const connection = await checkApiConnection(settings);
  if (connection.status !== "connected") {
    return await cachedMatches(connection.status, connection.message);
  }

  try {
    const lookup = await lookupSavedListings(settings, urls, source);
    const confirmedAt = new Date().toISOString();
    const currentCache = await loadSavedListingsCache();
    const prunedCache = removeLookupMissesFromSavedListingsCache(currentCache, urls, lookup.matches, source);
    const mergedCache = mergeApiMatchesIntoSavedListingsCache(prunedCache, lookup.matches, confirmedAt);
    await saveSavedListingsCache(mergedCache);
    const matchesByUrl = buildSavedListingMatchesByUrl(urls, mergedCache, "api", source);
    const autoSaveResult = await maybeAutoSaveLeasebreakListing({
      matchesByUrl,
      message,
      settings,
      tab,
      urls
    });

    return {
      apiStatus: "connected",
      cacheOnly: false,
      matchesByUrl: autoSaveResult.matchesByUrl,
      message: autoSaveResult.message ?? "Checked saved listings against PAMILA."
    };
  } catch {
    const refreshedConnection = await checkApiConnection(settings);
    return await cachedMatches(refreshedConnection.status, refreshedConnection.message);
  }
}

async function maybeAutoSaveLeasebreakListing(input: {
  matchesByUrl: Record<string, SavedListingSnapshot>;
  message: SavedListingLookupMessage;
  settings: Awaited<ReturnType<typeof loadExtensionSettings>>;
  tab: chrome.tabs.Tab | undefined;
  urls: string[];
}): Promise<{ matchesByUrl: Record<string, SavedListingSnapshot>; message?: string }> {
  const tabUrl = input.tab?.url ?? null;
  const page = tabUrl
    ? classifyExtensionPage(tabUrl)
    : {
        source: null,
        status: "unsupported_page" as const
      };
  const attempts = await loadLeasebreakAutoSaveAttempts();
  const canonicalUrl = input.urls[0] ? canonicalizeLeasebreakUrl(input.urls[0]) : null;
  const decision = decideLeasebreakAutoSave({
    allowAutoSaveCurrentPage: input.message.allowAutoSaveCurrentPage === true,
    alreadyAttempted: canonicalUrl ? attempts[canonicalUrl] !== undefined : false,
    currentTabUrl: tabUrl,
    matchesByUrl: input.matchesByUrl,
    page,
    requestedUrls: input.urls,
    settings: input.settings
  });

  if (!decision.shouldAutoSave || !decision.canonicalUrl || !input.tab?.id) {
    return {
      matchesByUrl: input.matchesByUrl
    };
  }

  await saveLeasebreakAutoSaveAttempts({
    ...attempts,
    [decision.canonicalUrl]: new Date().toISOString()
  });

  try {
    const response = await requestCapture(input.tab.id, input.settings);
    if (!response.ok) {
      throw new Error(response.error);
    }

    const imported = await postCapturePayload(input.settings, response.payload);
    const savedListing = savedListingFromCaptureImport(
      imported,
      response.payload.url,
      new Date().toISOString(),
      response.payload.source
    );
    await rememberSavedListing(savedListing);
    await showBadge("AUTO", "#166534");

    return {
      matchesByUrl: {
        ...buildSavedListingMatchesByUrl(input.urls, await loadSavedListingsCache(), "api", "leasebreak"),
        ...Object.fromEntries(
          input.urls.map((url) => [
            url,
            {
              ...savedListing,
              lookupSource: "api" as const
            }
          ])
        )
      },
      message: "Auto-saved this Leasebreak listing to PAMILA."
    };
  } catch (error) {
    await showBadge("ERR", "#9f1239");
    return {
      matchesByUrl: input.matchesByUrl,
      message: error instanceof Error ? `Auto-save failed: ${error.message}` : "Auto-save failed."
    };
  }
}

async function requestCapture(
  tabId: number,
  settings: Awaited<ReturnType<typeof loadExtensionSettings>>
): Promise<CaptureResponseMessage> {
  try {
    return await sendCaptureMessage(tabId, settings);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/contentScript.js"]
    });

    return await sendCaptureMessage(tabId, settings);
  }
}

async function sendCaptureMessage(
  tabId: number,
  settings: Awaited<ReturnType<typeof loadExtensionSettings>>
): Promise<CaptureResponseMessage> {
  return await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        type: CAPTURE_MESSAGE_TYPE,
        settings: {
          pageTextLimit: settings.pageTextLimit,
          selectedTextLimit: settings.selectedTextLimit,
          thumbnailLimit: settings.thumbnailLimit
        }
      },
      (response: CaptureResponseMessage | undefined) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        if (!response) {
          reject(new Error("No response from PAMILA content script."));
          return;
        }

        resolve(response);
      }
    );
  });
}

async function showBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });

  setTimeout(() => {
    void chrome.action.setBadgeText({ text: "" });
  }, 2000);
}

async function rememberSavedListing(savedListing: SavedListingSnapshot): Promise<void> {
  const cache = await loadSavedListingsCache();
  await saveSavedListingsCache({
    ...cache,
    [savedListing.canonicalUrl]: savedListing
  });
}

async function loadSavedListingsCache(): Promise<SavedListingsCache> {
  return await new Promise((resolve) => {
    chrome.storage.local.get(SAVED_LISTINGS_STORAGE_KEY, (result) => {
      const rawCache = result[SAVED_LISTINGS_STORAGE_KEY];
      resolve(isSavedListingsCache(rawCache) ? rawCache : {});
    });
  });
}

async function saveSavedListingsCache(cache: SavedListingsCache): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [SAVED_LISTINGS_STORAGE_KEY]: cache }, () => resolve());
  });
}

async function loadLeasebreakAutoSaveAttempts(): Promise<Record<string, string>> {
  return await new Promise((resolve) => {
    chrome.storage.local.get(LEASEBREAK_AUTO_SAVE_ATTEMPTS_STORAGE_KEY, (result) => {
      const rawAttempts = result[LEASEBREAK_AUTO_SAVE_ATTEMPTS_STORAGE_KEY];
      resolve(isStringRecord(rawAttempts) ? rawAttempts : {});
    });
  });
}

async function saveLeasebreakAutoSaveAttempts(attempts: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [LEASEBREAK_AUTO_SAVE_ATTEMPTS_STORAGE_KEY]: attempts }, () => resolve());
  });
}

function normalizeLookupUrls(urls: unknown): string[] {
  return Array.isArray(urls)
    ? [...new Set(urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0))]
        .map((url) => url.trim())
        .slice(0, 100)
    : [];
}

function normalizeLookupSource(source: unknown): SavedListingSource | undefined {
  return source === "airbnb" || source === "leasebreak" ? source : undefined;
}

function canonicalizeLeasebreakUrl(url: string): string {
  return canonicalizeExtensionListingUrl(url, "leasebreak");
}

function isSavedListingsCache(input: unknown): input is SavedListingsCache {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

function isStringRecord(input: unknown): input is Record<string, string> {
  return (
    Boolean(input && typeof input === "object" && !Array.isArray(input)) &&
    Object.values(input as Record<string, unknown>).every((value) => typeof value === "string")
  );
}

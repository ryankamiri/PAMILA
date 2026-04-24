import {
  CAPTURE_MESSAGE_TYPE,
  EXTENSION_DISPLAY_NAME,
  HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE,
  HELPER_CHECK_CONNECTION_MESSAGE_TYPE,
  type CaptureResponseMessage,
  type HelperCaptureResult
} from "./captureContract.js";
import { checkApiConnection, postCapturePayload } from "./apiClient.js";
import { classifyExtensionPage } from "./pageClassifier.js";
import { loadExtensionSettings } from "./settings.js";

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${EXTENSION_DISPLAY_NAME} installed.`);
});

chrome.action.onClicked.addListener((tab) => {
  void captureActiveTab(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === HELPER_CHECK_CONNECTION_MESSAGE_TYPE) {
    void handleConnectionCheck().then(sendResponse);
    return true;
  }

  if (message?.type === HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE) {
    void handleHelperCapture(sender.tab).then(sendResponse);
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

    await postCapturePayload(settings, response.payload);
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

    await postCapturePayload(settings, response.payload);
    await showBadge("OK", "#166534");

    return {
      ok: true,
      message: "Saved to PAMILA Inbox.",
      apiStatus: "connected"
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

async function handleConnectionCheck(): Promise<Awaited<ReturnType<typeof checkApiConnection>>> {
  const settings = await loadExtensionSettings();
  return await checkApiConnection(settings);
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

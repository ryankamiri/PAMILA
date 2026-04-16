import { CAPTURE_MESSAGE_TYPE, EXTENSION_DISPLAY_NAME, type CaptureResponseMessage } from "./captureContract.js";
import { detectListingSource } from "./extraction.js";
import { postCapturePayload } from "./apiClient.js";
import { loadExtensionSettings } from "./settings.js";

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${EXTENSION_DISPLAY_NAME} installed.`);
});

chrome.action.onClicked.addListener((tab) => {
  void captureActiveTab(tab);
});

async function captureActiveTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.url) {
    await showBadge("ERR", "#9f1239");
    console.warn("PAMILA capture failed: no active tab URL.");
    return;
  }

  const source = detectListingSource(tab.url);
  if (!source) {
    await showBadge("NO", "#92400e");
    console.warn("PAMILA capture skipped: unsupported source URL.", tab.url);
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

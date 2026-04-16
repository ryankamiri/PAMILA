import { DEFAULT_EXTENSION_SETTINGS, type ExtensionSettings } from "./captureContract.js";

const STORAGE_KEY = "pamilaExtensionSettings";

export function normalizeExtensionSettings(input: Partial<ExtensionSettings> | null | undefined): ExtensionSettings {
  const rawApiBaseUrl = typeof input?.apiBaseUrl === "string" ? input.apiBaseUrl : DEFAULT_EXTENSION_SETTINGS.apiBaseUrl;
  const apiBaseUrl = rawApiBaseUrl.replace(/\/+$/g, "") || DEFAULT_EXTENSION_SETTINGS.apiBaseUrl;

  return {
    apiBaseUrl,
    localToken: typeof input?.localToken === "string" ? input.localToken : DEFAULT_EXTENSION_SETTINGS.localToken,
    pageTextLimit: normalizePositiveInteger(input?.pageTextLimit, DEFAULT_EXTENSION_SETTINGS.pageTextLimit),
    selectedTextLimit: normalizePositiveInteger(input?.selectedTextLimit, DEFAULT_EXTENSION_SETTINGS.selectedTextLimit),
    thumbnailLimit: normalizePositiveInteger(input?.thumbnailLimit, DEFAULT_EXTENSION_SETTINGS.thumbnailLimit)
  };
}

export async function loadExtensionSettings(): Promise<ExtensionSettings> {
  const stored = await chromeStorageGet(STORAGE_KEY);
  return normalizeExtensionSettings(stored);
}

export async function saveExtensionSettings(settings: ExtensionSettings): Promise<void> {
  await chromeStorageSet(STORAGE_KEY, normalizeExtensionSettings(settings));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

async function chromeStorageGet(key: string): Promise<Partial<ExtensionSettings> | null> {
  return await new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve((result[key] as Partial<ExtensionSettings> | undefined) ?? null);
    });
  });
}

async function chromeStorageSet(key: string, value: ExtensionSettings): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

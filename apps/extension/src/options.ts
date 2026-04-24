import { checkApiConnection } from "./apiClient.js";
import { loadExtensionSettings, normalizeExtensionSettings, saveExtensionSettings } from "./settings.js";

const form = document.querySelector<HTMLFormElement>("#settings-form");
const apiBaseUrlInput = document.querySelector<HTMLInputElement>("#api-base-url");
const localTokenInput = document.querySelector<HTMLInputElement>("#local-token");
const statusElement = document.querySelector<HTMLElement>("#status");
const testConnectionButton = document.querySelector<HTMLButtonElement>("#test-connection");
const reloadExtensionButton = document.querySelector<HTMLButtonElement>("#reload-extension");
let statusClearTimeout: number | null = null;

void hydrateOptions();

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveOptions();
});

testConnectionButton?.addEventListener("click", () => {
  void testConnection();
});

reloadExtensionButton?.addEventListener("click", () => {
  setStatus("Reloading extension...");
  chrome.runtime.reload();
});

async function hydrateOptions(): Promise<void> {
  const settings = await loadExtensionSettings();

  if (apiBaseUrlInput) {
    apiBaseUrlInput.value = settings.apiBaseUrl;
  }

  if (localTokenInput) {
    localTokenInput.value = settings.localToken;
  }
}

async function saveOptions(): Promise<void> {
  const settings = readSettingsFromForm();

  await saveExtensionSettings(settings);
  setStatus("Saved.");
}

async function testConnection(): Promise<void> {
  const settings = readSettingsFromForm();
  await saveExtensionSettings(settings);
  setStatus("Checking...");

  const result = await checkApiConnection(settings);
  setStatus(result.message, 8_000);
}

function readSettingsFromForm(): ReturnType<typeof normalizeExtensionSettings> {
  const input: { apiBaseUrl?: string; localToken?: string } = {};

  if (apiBaseUrlInput) {
    input.apiBaseUrl = apiBaseUrlInput.value;
  }

  if (localTokenInput) {
    input.localToken = localTokenInput.value;
  }

  return normalizeExtensionSettings(input);
}

function setStatus(message: string, timeoutMs = 2_000): void {
  if (!statusElement) {
    return;
  }

  if (statusClearTimeout !== null) {
    window.clearTimeout(statusClearTimeout);
  }

  statusElement.textContent = message;
  statusClearTimeout = window.setTimeout(() => {
    statusElement.textContent = "";
    statusClearTimeout = null;
  }, timeoutMs);
}

import { loadExtensionSettings, normalizeExtensionSettings, saveExtensionSettings } from "./settings.js";

const form = document.querySelector<HTMLFormElement>("#settings-form");
const apiBaseUrlInput = document.querySelector<HTMLInputElement>("#api-base-url");
const localTokenInput = document.querySelector<HTMLInputElement>("#local-token");
const statusElement = document.querySelector<HTMLElement>("#status");

void hydrateOptions();

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveOptions();
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
  const input: { apiBaseUrl?: string; localToken?: string } = {};

  if (apiBaseUrlInput) {
    input.apiBaseUrl = apiBaseUrlInput.value;
  }

  if (localTokenInput) {
    input.localToken = localTokenInput.value;
  }

  const settings = normalizeExtensionSettings(input);

  await saveExtensionSettings(settings);
  setStatus("Saved.");
}

function setStatus(message: string): void {
  if (!statusElement) {
    return;
  }

  statusElement.textContent = message;
  setTimeout(() => {
    statusElement.textContent = "";
  }, 2000);
}

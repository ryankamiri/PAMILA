const pamilaContentScriptMarker = "pamila-content-script-ready";
const captureMessageType = "PAMILA_CAPTURE_CURRENT_PAGE";
const helperCaptureActiveTabMessageType = "PAMILA_HELPER_CAPTURE_ACTIVE_TAB";
const helperCheckConnectionMessageType = "PAMILA_HELPER_CHECK_CONNECTION";
const helperRootId = "pamila-floating-helper-root";
const helperStorageKey = "pamilaHelperWalkthroughComplete";
const dashboardUrl = "http://localhost:5173";
const dashboardInboxUrl = `${dashboardUrl}/#inbox`;
const defaultPageTextLimit = 12_000;
const defaultSelectedTextLimit = 4_000;
const defaultThumbnailLimit = 8;

type ListingSource = "airbnb" | "leasebreak";
type HelperPageStatus = "listing_page" | "search_page" | "unsupported_page";
type ApiConnectionStatus = "connected" | "token_issue" | "api_offline" | "checking";
type HelperSaveStatus = "idle" | "saving" | "saved" | "error";

interface CaptureRequestMessage {
  type: typeof captureMessageType;
  settings?: {
    pageTextLimit?: number;
    selectedTextLimit?: number;
    thumbnailLimit?: number;
  };
}

interface ThumbnailCandidate {
  url: string;
  width: number | null;
  height: number | null;
}

interface ListingLocation {
  label: string;
  address: string | null;
  crossStreets: string | null;
  neighborhood: string | null;
  geographyCategory: "manhattan" | "lic_astoria" | "brooklyn" | "other" | "unknown";
  lat: number | null;
  lng: number | null;
  source: "exact_address" | "cross_streets" | "airbnb_approx_pin" | "neighborhood" | "manual_guess";
  confidence: "exact" | "high" | "medium" | "low";
  isUserConfirmed: boolean;
}

interface CapturePayload {
  source: ListingSource;
  url: string;
  title: string | null;
  visibleFields: Record<string, string>;
  selectedText: string | null;
  pageText: string | null;
  approxLocation: ListingLocation | null;
  thumbnailCandidates: ThumbnailCandidate[];
  capturedAt: string;
}

interface HelperPageClassification {
  source: ListingSource | null;
  status: HelperPageStatus;
}

interface HelperState {
  isOpen: boolean;
  walkthroughComplete: boolean;
  apiStatus: ApiConnectionStatus;
  saveStatus: HelperSaveStatus;
  message: string | null;
}

document.documentElement.dataset.pamilaCapture = pamilaContentScriptMarker;

chrome.runtime.onMessage.addListener((message: CaptureRequestMessage, _sender, sendResponse) => {
  if (message?.type !== captureMessageType) {
    return false;
  }

  try {
    sendResponse({
      ok: true,
      payload: buildCapturePayload(message)
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown capture error."
    });
  }

  return true;
});

void initializePamilaHelper();

async function initializePamilaHelper(): Promise<void> {
  if (document.getElementById(helperRootId)) {
    return;
  }

  const classification = classifyCurrentHelperPage(window.location.href);
  const state: HelperState = {
    isOpen: classification.status !== "listing_page",
    walkthroughComplete: await loadWalkthroughCompletion(),
    apiStatus: "checking",
    saveStatus: "idle",
    message: null
  };

  if (!state.walkthroughComplete) {
    state.isOpen = true;
  }

  const container = document.createElement("div");
  container.id = helperRootId;
  container.style.all = "initial";
  const shadow = container.attachShadow({ mode: "open" });
  document.documentElement.append(container);

  const render = (): void => {
    renderHelper(shadow, classification, state, {
      onToggle: () => {
        state.isOpen = !state.isOpen;
        render();
      },
      onSave: async () => {
        await saveCurrentListing(state, render);
      },
      onQuickSave: async () => {
        if (state.apiStatus === "api_offline" || state.apiStatus === "token_issue") {
          state.isOpen = true;
          state.message = getApiStatusMessage(state.apiStatus);
          render();
          return;
        }

        await saveCurrentListing(state, render);
      },
      onCheckConnection: async () => {
        state.apiStatus = "checking";
        state.message = "Checking PAMILA API...";
        render();

        const response = await sendRuntimeMessage<{ status?: ApiConnectionStatus; message?: string }>({
          type: helperCheckConnectionMessageType
        });

        state.apiStatus = normalizeApiStatus(response?.status);
        state.message = response?.message ?? getApiStatusMessage(state.apiStatus);
        render();
      },
      onOpenDashboard: () => {
        window.open(dashboardUrl, "_blank", "noopener");
      },
      onOpenInbox: () => {
        window.open(dashboardInboxUrl, "_blank", "noopener");
      },
      onDismissWalkthrough: async () => {
        state.walkthroughComplete = true;
        await saveWalkthroughCompletion();
        render();
      }
    });
  };

  render();

  const connection = await sendRuntimeMessage<{ status?: ApiConnectionStatus; message?: string }>({
    type: helperCheckConnectionMessageType
  });

  state.apiStatus = normalizeApiStatus(connection?.status);
  state.message = connection?.message ?? null;
  render();
}

async function saveCurrentListing(state: HelperState, render: () => void): Promise<void> {
  state.saveStatus = "saving";
  state.message = "Saving this listing to PAMILA...";
  render();

  const response = await sendRuntimeMessage<{ ok: boolean; message: string; apiStatus?: ApiConnectionStatus }>({
    type: helperCaptureActiveTabMessageType
  });

  state.apiStatus = normalizeApiStatus(response?.apiStatus);
  state.saveStatus = response?.ok ? "saved" : "error";
  state.message = response?.message ?? "PAMILA capture did not return a response.";
  if (!response?.ok) {
    state.isOpen = true;
  }
  render();
}

function renderHelper(
  shadow: ShadowRoot,
  classification: HelperPageClassification,
  state: HelperState,
  handlers: {
    onToggle: () => void;
    onSave: () => void;
    onQuickSave: () => void;
    onCheckConnection: () => void;
    onOpenDashboard: () => void;
    onOpenInbox: () => void;
    onDismissWalkthrough: () => void;
  }
): void {
  const apiLabel = getApiStatusLabel(state.apiStatus);
  const pageLabel = getHelperPageStatusLabel(classification.status);
  const sourceLabel = classification.source === "airbnb" ? "Airbnb" : classification.source === "leasebreak" ? "Leasebreak" : "Unsupported";

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .pamila-helper {
        bottom: 20px;
        box-sizing: border-box;
        color: #111827;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        position: fixed;
        right: 20px;
        width: min(360px, calc(100vw - 32px));
        z-index: 2147483647;
      }

      .pamila-toggle,
      .pamila-quick-save,
      .pamila-quick-inbox,
      .pamila-panel,
      .pamila-button,
      .pamila-link {
        font: inherit;
      }

      .pamila-toggle {
        align-items: center;
        background: #2e7d6b;
        border: 0;
        border-radius: 8px;
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.24);
        color: white;
        cursor: pointer;
        display: flex;
        font-size: 14px;
        font-weight: 800;
        gap: 10px;
        justify-content: space-between;
        margin-left: auto;
        padding: 12px 14px;
      }

      .pamila-quick-row {
        align-items: stretch;
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-bottom: 8px;
      }

      .pamila-quick-save,
      .pamila-quick-inbox {
        align-items: center;
        border-radius: 8px;
        box-shadow: 0 14px 32px rgba(15, 23, 42, 0.2);
        box-sizing: border-box;
        cursor: pointer;
        display: inline-flex;
        font-size: 13px;
        font-weight: 900;
        justify-content: center;
        min-height: 42px;
        padding: 10px 14px;
      }

      .pamila-quick-save {
        background: ${getQuickSaveBackground(state)};
        border: 1px solid ${getQuickSaveBorder(state)};
        color: white;
        min-width: 142px;
      }

      .pamila-quick-save[disabled] {
        cursor: default;
        opacity: 0.78;
      }

      .pamila-quick-inbox {
        background: #ffffff;
        border: 1px solid #b8d7ce;
        color: #245f52;
        min-width: 92px;
      }

      .pamila-toggle-dot {
        background: ${getApiStatusColor(state.apiStatus)};
        border-radius: 999px;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
        height: 10px;
        width: 10px;
      }

      .pamila-panel {
        background: #ffffff;
        border: 1px solid #dbe3ef;
        border-radius: 8px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.26);
        box-sizing: border-box;
        margin-top: 10px;
        overflow: hidden;
      }

      .pamila-panel-header {
        align-items: flex-start;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        padding: 14px 14px 12px;
      }

      .pamila-title {
        font-size: 18px;
        font-weight: 900;
        line-height: 1.1;
        margin: 0;
      }

      .pamila-subtitle {
        color: #64748b;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        margin-top: 4px;
        text-transform: uppercase;
      }

      .pamila-close {
        background: transparent;
        border: 0;
        color: #475569;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 0 2px;
      }

      .pamila-panel-body {
        display: grid;
        gap: 12px;
        padding: 14px;
      }

      .pamila-status-grid {
        display: grid;
        gap: 8px;
        grid-template-columns: 1fr 1fr;
      }

      .pamila-status {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px;
      }

      .pamila-status-label {
        color: #64748b;
        display: block;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.06em;
        margin-bottom: 4px;
        text-transform: uppercase;
      }

      .pamila-status-value {
        color: #111827;
        font-size: 14px;
        font-weight: 800;
      }

      .pamila-message {
        background: ${getMessageBackground(state.saveStatus, state.apiStatus)};
        border-left: 4px solid ${getMessageBorder(state.saveStatus, state.apiStatus)};
        border-radius: 8px;
        color: #1f2937;
        font-size: 13px;
        line-height: 1.45;
        padding: 10px 12px;
      }

      .pamila-section-title {
        color: #111827;
        font-size: 14px;
        font-weight: 900;
        margin: 0;
      }

      .pamila-list {
        color: #475569;
        display: grid;
        font-size: 13px;
        gap: 6px;
        line-height: 1.35;
        margin: 0;
        padding-left: 18px;
      }

      .pamila-actions {
        display: grid;
        gap: 8px;
      }

      .pamila-button,
      .pamila-link {
        align-items: center;
        border-radius: 8px;
        box-sizing: border-box;
        cursor: pointer;
        display: inline-flex;
        font-size: 14px;
        font-weight: 900;
        justify-content: center;
        min-height: 42px;
        padding: 10px 12px;
        text-decoration: none;
      }

      .pamila-button {
        background: #2e7d6b;
        border: 1px solid #2e7d6b;
        color: white;
      }

      .pamila-button[disabled] {
        cursor: wait;
        opacity: 0.7;
      }

      .pamila-secondary {
        background: #eef7f4;
        border-color: #b8d7ce;
        color: #245f52;
      }

      .pamila-link {
        background: #f8fafc;
        border: 1px solid #dbe3ef;
        color: #1f4f46;
      }

      .pamila-walkthrough {
        background: #fff7df;
        border: 1px solid #f2d98a;
        border-radius: 8px;
        padding: 12px;
      }

      .pamila-walkthrough .pamila-list {
        color: #473b17;
      }

      .pamila-muted {
        color: #64748b;
        font-size: 12px;
        line-height: 1.4;
      }
    </style>
    <div class="pamila-helper">
      ${classification.status === "listing_page" ? renderQuickSaveMarkup(state) : ""}
      <button class="pamila-toggle" type="button" aria-expanded="${state.isOpen ? "true" : "false"}">
        <span>PAMILA</span>
        <span class="pamila-toggle-dot" aria-hidden="true"></span>
      </button>
      ${
        state.isOpen
          ? `
        <section class="pamila-panel" role="dialog" aria-label="PAMILA capture helper">
          <div class="pamila-panel-header">
            <div>
              <h2 class="pamila-title">PAMILA Capture</h2>
              <div class="pamila-subtitle">${escapeHtml(sourceLabel)} helper</div>
            </div>
            <button class="pamila-close" type="button" aria-label="Close PAMILA helper">x</button>
          </div>
          <div class="pamila-panel-body">
            <div class="pamila-status-grid">
              <div class="pamila-status">
                <span class="pamila-status-label">API</span>
                <span class="pamila-status-value">${escapeHtml(apiLabel)}</span>
              </div>
              <div class="pamila-status">
                <span class="pamila-status-label">Page</span>
                <span class="pamila-status-value">${escapeHtml(pageLabel)}</span>
              </div>
            </div>
            ${state.message ? `<div class="pamila-message" role="status">${escapeHtml(state.message)}</div>` : ""}
            ${state.walkthroughComplete ? "" : renderWalkthroughMarkup()}
            ${renderGuidanceMarkup(classification.status)}
            <div class="pamila-actions">
              ${renderPrimaryActionMarkup(classification.status, state.saveStatus)}
              <button class="pamila-button pamila-secondary" type="button" data-pamila-action="check">Check API connection</button>
              <button class="pamila-link" type="button" data-pamila-action="dashboard">Open PAMILA dashboard</button>
            </div>
            <div class="pamila-muted">PAMILA captures only the page you are viewing. It does not crawl search results or background-fetch listing pages.</div>
          </div>
        </section>
      `
          : ""
      }
    </div>
  `;

  shadow.querySelector<HTMLButtonElement>('[data-pamila-action="quick-save"]')?.addEventListener("click", handlers.onQuickSave);
  shadow.querySelector<HTMLButtonElement>('[data-pamila-action="inbox"]')?.addEventListener("click", handlers.onOpenInbox);
  shadow.querySelector<HTMLButtonElement>(".pamila-toggle")?.addEventListener("click", handlers.onToggle);
  shadow.querySelector<HTMLButtonElement>(".pamila-close")?.addEventListener("click", handlers.onToggle);
  shadow.querySelector<HTMLButtonElement>('[data-pamila-action="save"]')?.addEventListener("click", handlers.onSave);
  shadow.querySelector<HTMLButtonElement>('[data-pamila-action="check"]')?.addEventListener("click", handlers.onCheckConnection);
  shadow.querySelector<HTMLButtonElement>('[data-pamila-action="dashboard"]')?.addEventListener("click", handlers.onOpenDashboard);
  shadow.querySelector<HTMLButtonElement>('[data-pamila-action="dismiss-walkthrough"]')?.addEventListener("click", () => {
    void handlers.onDismissWalkthrough();
  });
}

function renderQuickSaveMarkup(state: HelperState): string {
  const disabled = state.saveStatus === "saving" || state.apiStatus === "checking" || state.saveStatus === "saved";
  return `
    <div class="pamila-quick-row" role="group" aria-label="PAMILA quick save">
      <button class="pamila-quick-save" type="button" data-pamila-action="quick-save" ${disabled ? "disabled" : ""}>
        ${escapeHtml(getQuickSaveLabel(state))}
      </button>
      ${
        state.saveStatus === "saved"
          ? `<button class="pamila-quick-inbox" type="button" data-pamila-action="inbox">Open Inbox</button>`
          : ""
      }
    </div>
  `;
}

function renderPrimaryActionMarkup(pageStatus: HelperPageStatus, saveStatus: HelperSaveStatus): string {
  if (pageStatus !== "listing_page") {
    return `<button class="pamila-button" type="button" disabled>${pageStatus === "search_page" ? "Open a listing first" : "Unsupported page"}</button>`;
  }

  return `<button class="pamila-button" type="button" data-pamila-action="save" ${saveStatus === "saving" ? "disabled" : ""}>${
    saveStatus === "saving" ? "Saving..." : "Save this listing to PAMILA"
  }</button>`;
}

function getQuickSaveLabel(state: HelperState): string {
  if (state.saveStatus === "saving") {
    return "Saving...";
  }

  if (state.saveStatus === "saved") {
    return "Saved to PAMILA";
  }

  if (state.saveStatus === "error") {
    return "Save failed";
  }

  if (state.apiStatus === "api_offline") {
    return "API offline";
  }

  if (state.apiStatus === "token_issue") {
    return "Fix token";
  }

  if (state.apiStatus === "checking") {
    return "Checking...";
  }

  return "Save to PAMILA";
}

function getQuickSaveBackground(state: HelperState): string {
  if (state.saveStatus === "saved") {
    return "#166534";
  }

  if (state.saveStatus === "error" || state.apiStatus === "api_offline" || state.apiStatus === "token_issue") {
    return "#b45309";
  }

  return "#2e7d6b";
}

function getQuickSaveBorder(state: HelperState): string {
  if (state.saveStatus === "saved") {
    return "#166534";
  }

  if (state.saveStatus === "error" || state.apiStatus === "api_offline" || state.apiStatus === "token_issue") {
    return "#b45309";
  }

  return "#2e7d6b";
}

function renderWalkthroughMarkup(): string {
  return `
    <section class="pamila-walkthrough">
      <h3 class="pamila-section-title">Quick start</h3>
      <ul class="pamila-list">
        <li>Open a specific listing before saving.</li>
        <li>Airbnb filters: NYC/Manhattan, Jun 30 or Jul 1 through Sep 12, entire place, max around $3,600 monthly.</li>
        <li>Leasebreak date windows matter: earliest/latest move-in and move-out can change ranking.</li>
        <li>Click Save this listing to send it to Inbox.</li>
      </ul>
      <button class="pamila-button pamila-secondary" type="button" data-pamila-action="dismiss-walkthrough">Got it</button>
    </section>
  `;
}

function renderGuidanceMarkup(pageStatus: HelperPageStatus): string {
  if (pageStatus === "listing_page") {
    return `
      <section>
        <h3 class="pamila-section-title">Ready to save</h3>
        <ul class="pamila-list">
          <li>Use this on one Airbnb or Leasebreak listing page at a time.</li>
          <li>After saving, clean up price, dates, stay type, and location in PAMILA Inbox.</li>
        </ul>
      </section>
    `;
  }

  if (pageStatus === "search_page") {
    return `
      <section>
        <h3 class="pamila-section-title">Search page guidance</h3>
        <ul class="pamila-list">
          <li>Search pages are noisy, so PAMILA will not batch-capture visible cards.</li>
          <li>Open one promising listing page, then save it from there.</li>
          <li>Checklist: NYC/Manhattan, Jun 30 or Jul 1 to Sep 12, entire place, max around $3,600 monthly.</li>
        </ul>
      </section>
    `;
  }

  return `
    <section>
      <h3 class="pamila-section-title">Unsupported page</h3>
      <ul class="pamila-list">
        <li>PAMILA only captures Airbnb and Leasebreak listing pages.</li>
      </ul>
    </section>
  `;
}

function classifyCurrentHelperPage(url: string): HelperPageClassification {
  const source = detectListingSource(url);
  if (!source) {
    return {
      source: null,
      status: "unsupported_page"
    };
  }

  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return {
      source,
      status: "unsupported_page"
    };
  }

  if (source === "airbnb") {
    return {
      source,
      status: /^\/rooms\/\d+(?:$|[/?#])/.test(pathname) || /^\/luxury\/listing\//.test(pathname) ? "listing_page" : "search_page"
    };
  }

  return {
    source,
    status:
      pathname.includes("/short-term-rental-details/") || pathname.includes("/rental-details/")
        ? "listing_page"
        : "search_page"
  };
}

async function sendRuntimeMessage<T>(message: Record<string, unknown>): Promise<T | null> {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      const error = chrome.runtime.lastError;
      if (error || !response) {
        resolve(null);
        return;
      }

      resolve(response);
    });
  });
}

async function loadWalkthroughCompletion(): Promise<boolean> {
  return await new Promise((resolve) => {
    chrome.storage.local.get(helperStorageKey, (result) => {
      resolve(result[helperStorageKey] === true);
    });
  });
}

async function saveWalkthroughCompletion(): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [helperStorageKey]: true }, () => {
      resolve();
    });
  });
}

function normalizeApiStatus(status: unknown): ApiConnectionStatus {
  if (status === "connected" || status === "token_issue" || status === "api_offline") {
    return status;
  }

  return "api_offline";
}

function getApiStatusLabel(status: ApiConnectionStatus): string {
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

function getApiStatusMessage(status: ApiConnectionStatus): string {
  if (status === "connected") {
    return "Connected to PAMILA API.";
  }

  if (status === "token_issue") {
    return "API is running, but the extension token does not match PAMILA_LOCAL_TOKEN.";
  }

  if (status === "api_offline") {
    return "Could not reach the local PAMILA API.";
  }

  return "Checking PAMILA API...";
}

function getHelperPageStatusLabel(status: HelperPageStatus): string {
  if (status === "listing_page") {
    return "Listing page";
  }

  if (status === "search_page") {
    return "Search page";
  }

  return "Unsupported page";
}

function getApiStatusColor(status: ApiConnectionStatus): string {
  if (status === "connected") {
    return "#16a34a";
  }

  if (status === "token_issue") {
    return "#b45309";
  }

  if (status === "api_offline") {
    return "#be123c";
  }

  return "#64748b";
}

function getMessageBackground(saveStatus: HelperSaveStatus, apiStatus: ApiConnectionStatus): string {
  if (saveStatus === "saved" || apiStatus === "connected") {
    return "#ecfdf5";
  }

  if (saveStatus === "error" || apiStatus === "token_issue" || apiStatus === "api_offline") {
    return "#fff7ed";
  }

  return "#f8fafc";
}

function getMessageBorder(saveStatus: HelperSaveStatus, apiStatus: ApiConnectionStatus): string {
  if (saveStatus === "saved" || apiStatus === "connected") {
    return "#2e7d6b";
  }

  if (saveStatus === "error" || apiStatus === "token_issue" || apiStatus === "api_offline") {
    return "#f59e0b";
  }

  return "#cbd5e1";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildCapturePayload(message: CaptureRequestMessage): CapturePayload {
  const source = detectListingSource(window.location.href);
  if (!source) {
    throw new Error("This page is not an Airbnb or Leasebreak listing.");
  }

  const pageTextLimit = normalizePositiveInteger(message.settings?.pageTextLimit, defaultPageTextLimit);
  const selectedTextLimit = normalizePositiveInteger(message.settings?.selectedTextLimit, defaultSelectedTextLimit);
  const thumbnailLimit = normalizePositiveInteger(message.settings?.thumbnailLimit, defaultThumbnailLimit);
  const pageText = truncateText(getVisiblePageText(), pageTextLimit);
  const selectedText = truncateText(window.getSelection()?.toString() ?? null, selectedTextLimit);
  const textForParsing = [document.title, selectedText, pageText].filter(Boolean).join(" ");

  return {
    source,
    url: window.location.href,
    title: truncateText(document.title, 300),
    visibleFields: extractVisibleFieldsFromText(source, textForParsing),
    selectedText,
    pageText,
    approxLocation: source === "airbnb" ? extractApproxAirbnbLocation(textForParsing) : null,
    thumbnailCandidates: extractThumbnailCandidates(thumbnailLimit),
    capturedAt: new Date().toISOString()
  };
}

function detectListingSource(url: string): ListingSource | null {
  let hostname: string;

  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (hostname === "airbnb.com" || hostname.endsWith(".airbnb.com")) {
    return "airbnb";
  }

  if (hostname === "leasebreak.com" || hostname.endsWith(".leasebreak.com")) {
    return "leasebreak";
  }

  return null;
}

function getVisiblePageText(): string | null {
  const body = document.body;
  if (!body) {
    return null;
  }

  return body.innerText || body.textContent;
}

function extractVisibleFieldsFromText(source: ListingSource, text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const normalized = text.replace(/\s+/g, " ").trim();

  const rent = findFirstMatch(normalized, [
    /\$[\d,]+(?:\s*(?:\/\s*)?(?:month|mo|monthly))\b/i,
    /\$[\d,]+(?=\s+per\s+month\b)/i,
    /\$[\d,]+/i
  ]);
  if (rent) {
    fields.monthly_rent_candidate = rent;
  }

  const bedroom = findFirstMatch(normalized, [
    /\bstudio\b/i,
    /\b\d+(?:\.\d+)?\s*(?:bedrooms?|beds?|br)\b/i
  ]);
  if (bedroom) {
    fields.bedroom_candidate = bedroom;
  }

  const bathroom = findFirstMatch(normalized, [
    /\b(private|shared)\s+bath(?:room)?\b/i,
    /\b\d+(?:\.\d+)?\s+bath(?:rooms?)?\b/i
  ]);
  if (bathroom) {
    fields.bathroom_candidate = bathroom;
  }

  const stayType = inferStayType(normalized);
  if (stayType !== "unknown") {
    fields.stay_type_candidate = stayType;
  }

  if (/\bkitchen\b/i.test(normalized)) {
    fields.kitchen_candidate = "mentioned";
  }

  if (/\bwasher\b|\blaundry\b/i.test(normalized)) {
    fields.washer_candidate = inferWasherValue(normalized);
  }

  if (/\bfurnished\b/i.test(normalized)) {
    fields.furnished_candidate = /\bunfurnished\b/i.test(normalized) ? "no" : "yes";
  }

  if (source === "leasebreak") {
    addDateCandidate(fields, normalized, "earliest_move_in_candidate", /earliest\s+move[-\s]?in\s+date\s*:?\s*([^|]{1,80}?)(?=\s+(?:latest|earliest\s+move[-\s]?out|$))/i);
    addDateCandidate(fields, normalized, "latest_move_in_candidate", /latest\s+move[-\s]?in\s+date\s*:?\s*([^|]{1,80}?)(?=\s+(?:earliest\s+move[-\s]?out|latest\s+move[-\s]?out|$))/i);
    addDateCandidate(fields, normalized, "earliest_move_out_candidate", /earliest\s+move[-\s]?out\s+date\s*:?\s*([^|]{1,80}?)(?=\s+(?:latest\s+move[-\s]?out|$))/i);
    addDateCandidate(fields, normalized, "latest_move_out_candidate", /latest\s+move[-\s]?out\s+date\s*:?\s*([^|]{1,80})/i);

    if (/\bimmediate\b/i.test(normalized)) {
      fields.move_in_urgency_candidate = "immediate";
  }
}

  if (/\bmonth[-\s]?to[-\s]?month\b/i.test(normalized)) {
    fields.month_to_month_candidate = "yes";
  }

  return fields;
}

function extractApproxAirbnbLocation(text: string): ListingLocation | null {
  const coordinates = extractCoordinates();
  const label = extractAirbnbLocationLabel(text) ?? "Airbnb approximate location";

  if (!coordinates && label === "Airbnb approximate location") {
    return null;
  }

  return {
    label,
    address: null,
    crossStreets: null,
    neighborhood: label === "Airbnb approximate location" ? null : label,
    geographyCategory: "unknown",
    lat: coordinates?.lat ?? null,
    lng: coordinates?.lng ?? null,
    source: "airbnb_approx_pin",
    confidence: coordinates ? "medium" : "low",
    isUserConfirmed: false
  };
}

function extractCoordinates(): { lat: number; lng: number } | null {
  const metaLatitude = readMetaContent(["place:location:latitude", "og:latitude", "latitude"]);
  const metaLongitude = readMetaContent(["place:location:longitude", "og:longitude", "longitude"]);
  const lat = metaLatitude ? Number.parseFloat(metaLatitude) : Number.NaN;
  const lng = metaLongitude ? Number.parseFloat(metaLongitude) : Number.NaN;

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  const coordinateMatch = window.location.href.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (coordinateMatch?.[1] && coordinateMatch[2]) {
    return {
      lat: Number.parseFloat(coordinateMatch[1]),
      lng: Number.parseFloat(coordinateMatch[2])
    };
  }

  return null;
}

function extractAirbnbLocationLabel(text: string): string | null {
  const match =
    text.match(/where\s+you[’']?ll\s+be\s+([^.,|]{3,80})/i) ??
    text.match(/neighborhood\s+([^.,|]{3,80})/i) ??
    text.match(/location\s+([^.,|]{3,80})/i);

  return sanitizeFieldValue(match?.[1] ?? null);
}

function extractThumbnailCandidates(limit: number): ThumbnailCandidate[] {
  const candidates: ThumbnailCandidate[] = [];
  const metaImage = readMetaContent(["og:image", "twitter:image"]);

  if (metaImage) {
    candidates.push({
      url: metaImage,
      width: null,
      height: null
    });
  }

  for (const image of Array.from(document.images)) {
    const url = image.currentSrc || image.src;
    if (!url) {
      continue;
    }

    candidates.push({
      url,
      width: image.naturalWidth || image.width || null,
      height: image.naturalHeight || image.height || null
    });
  }

  const seen = new Set<string>();
  const normalized: ThumbnailCandidate[] = [];

  for (const candidate of candidates) {
    if (!/^https?:\/\//i.test(candidate.url) || /\.svg(?:$|\?)/i.test(candidate.url) || seen.has(candidate.url)) {
      continue;
    }

    seen.add(candidate.url);
    normalized.push(candidate);

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function readMetaContent(names: string[]): string | null {
  for (const name of names) {
    const escapedName = cssEscape(name);
    const element = document.querySelector<HTMLMetaElement>(
      `meta[property="${escapedName}"], meta[name="${escapedName}"], meta[itemprop="${escapedName}"]`
    );
    const content = element?.content?.trim();
    if (content) {
      return content;
    }
  }

  return null;
}

function inferStayType(text: string): "entire_apartment" | "private_room" | "shared_room" | "unknown" {
  if (/\bprivate\s+room\b/i.test(text)) {
    return "private_room";
  }

  if (/\bshared\s+room\b/i.test(text)) {
    return "shared_room";
  }

  if (/\bentire\s+(?:rental\s+unit|home|place|apartment|condo|loft|guest\s+suite)\b/i.test(text)) {
    return "entire_apartment";
  }

  return "unknown";
}

function inferWasherValue(text: string): string {
  if (/\bwasher\s+in\s+unit\b|\bin[-\s]?unit\s+(?:washer|laundry)\b/i.test(text)) {
    return "in_unit";
  }

  if (/\bwasher\s+in\s+building\b|\bin[-\s]?building\s+(?:washer|laundry)\b|\blaundry\s+in\s+building\b/i.test(text)) {
    return "in_building";
  }

  if (/\bno\s+washer\b|\bwasher\s+not\b/i.test(text)) {
    return "no";
  }

  return "mentioned";
}

function addDateCandidate(fields: Record<string, string>, text: string, key: string, pattern: RegExp): void {
  const value = sanitizeFieldValue(text.match(pattern)?.[1] ?? null);
  if (!value) {
    return;
  }

  fields[key] =
    findFirstMatch(value, [
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:,?\s+\d{4})?\b/i,
      /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
      /\bimmediate\b/i,
      /\bflexible\b/i
    ]) ?? value;
}

function findFirstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = sanitizeFieldValue(match?.[0] ?? null);
    if (value) {
      return value;
    }
  }

  return null;
}

function sanitizeFieldValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").replace(/^[\s:,-]+|[\s:,-]+$/g, "").trim();
  return cleaned || null;
}

function truncateText(value: string | null | undefined, limit: number): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > limit ? normalized.slice(0, limit).trimEnd() : normalized;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/"/g, '\\"');
}

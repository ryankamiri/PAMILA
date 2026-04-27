const pamilaContentScriptMarker = "pamila-content-script-ready";
const captureMessageType = "PAMILA_CAPTURE_CURRENT_PAGE";
const helperCaptureActiveTabMessageType = "PAMILA_HELPER_CAPTURE_ACTIVE_TAB";
const helperCheckConnectionMessageType = "PAMILA_HELPER_CHECK_CONNECTION";
const helperLookupListingsMessageType = "PAMILA_HELPER_LOOKUP_LISTINGS";
const helperRootId = "pamila-floating-helper-root";
const helperStorageKey = "pamilaHelperWalkthroughComplete";
const dashboardUrl = "http://localhost:5173";
const dashboardInboxUrl = `${dashboardUrl}/#inbox`;
const defaultPageTextLimit = 12_000;
const defaultSelectedTextLimit = 4_000;
const defaultThumbnailLimit = 8;
let isApplyingAirbnbSavedBadges = false;

type ListingSource = "airbnb" | "leasebreak";
type HelperPageStatus = "listing_page" | "search_page" | "unsupported_page";
type ApiConnectionStatus = "connected" | "token_issue" | "api_offline" | "checking";
type HelperSaveStatus = "idle" | "saving" | "saved" | "error";
type SavedLookupSource = "api" | "cache";

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
  savedListing: SavedListingSnapshot | null;
  savedLookupSource: SavedLookupSource | null;
  searchSavedCardCount: number | null;
  searchSavedCardMessage: string | null;
}

interface SavedListingSnapshot {
  canonicalUrl: string;
  listingId: string;
  sourceUrl: string;
  status: string;
  title: string;
  savedAt: string;
  lastConfirmedAt: string;
  lookupSource?: SavedLookupSource;
}

interface SavedListingLookupResult {
  apiStatus?: ApiConnectionStatus;
  cacheOnly?: boolean;
  matchesByUrl?: Record<string, SavedListingSnapshot>;
  message?: string;
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
    message: null,
    savedListing: null,
    savedLookupSource: null,
    searchSavedCardCount: null,
    searchSavedCardMessage: null
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
      onRefreshFacts: async () => {
        await saveCurrentListing(state, render, { refreshExisting: true });
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
      onOpenDetails: () => {
        window.open(dashboardListingUrl(state.savedListing?.listingId ?? null), "_blank", "noopener");
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

  if (classification.status === "listing_page") {
    await refreshListingSavedState(classification, state, render);
  } else if (classification.source === "airbnb" && classification.status === "search_page") {
    initializeAirbnbSearchBadges(state, render);
  }
}

async function saveCurrentListing(
  state: HelperState,
  render: () => void,
  options: { refreshExisting?: boolean } = {}
): Promise<void> {
  if (state.savedListing && !options.refreshExisting) {
    state.isOpen = true;
    state.message = "This listing is already in PAMILA.";
    render();
    return;
  }

  state.saveStatus = "saving";
  state.message = options.refreshExisting ? "Refreshing PAMILA facts from this page..." : "Saving this listing to PAMILA...";
  render();

  const response = await sendRuntimeMessage<{
    ok: boolean;
    message: string;
    apiStatus?: ApiConnectionStatus;
    savedListing?: SavedListingSnapshot;
  }>({
    type: helperCaptureActiveTabMessageType
  });

  state.apiStatus = normalizeApiStatus(response?.apiStatus);
  state.saveStatus = response?.ok ? "saved" : "error";
  state.message = response?.message ?? "PAMILA capture did not return a response.";
  if (response?.ok && response.savedListing) {
    state.savedListing = response.savedListing;
    state.savedLookupSource = response.savedListing.lookupSource ?? "api";
  }
  if (!response?.ok) {
    state.isOpen = true;
  }
  render();
}

async function refreshListingSavedState(
  classification: HelperPageClassification,
  state: HelperState,
  render: () => void
): Promise<void> {
  const lookupMessage = classification.source
    ? {
        type: helperLookupListingsMessageType,
        allowAutoSaveCurrentPage: classification.source === "leasebreak",
        source: classification.source,
        urls: [window.location.href]
      }
    : { type: helperLookupListingsMessageType, urls: [window.location.href] };
  const response = await sendRuntimeMessage<SavedListingLookupResult>(lookupMessage);

  if (!response) {
    return;
  }

  state.apiStatus = normalizeApiStatus(response.apiStatus);
  const savedListing = response.matchesByUrl?.[window.location.href] ?? Object.values(response.matchesByUrl ?? {})[0] ?? null;
  if (savedListing) {
    state.savedListing = savedListing;
    state.savedLookupSource = savedListing.lookupSource ?? (response.cacheOnly ? "cache" : "api");
    state.saveStatus = "saved";
    state.message =
      state.savedLookupSource === "cache"
        ? "This listing is already in PAMILA. Showing saved state from local extension cache because the API could not confirm it right now."
        : "This listing is already in PAMILA.";
  } else if (state.saveStatus !== "error") {
    state.savedListing = null;
    state.savedLookupSource = null;
    state.saveStatus = "idle";
    state.message = response.message ?? state.message;
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
    onRefreshFacts: () => void;
    onCheckConnection: () => void;
    onOpenDashboard: () => void;
    onOpenDetails: () => void;
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
      .pamila-quick-refresh,
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
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
        margin-bottom: 8px;
      }

      .pamila-quick-save,
      .pamila-quick-inbox,
      .pamila-quick-refresh {
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

      .pamila-quick-refresh {
        background: #eef7f4;
        border: 1px solid #9ccbc0;
        color: #1f4f46;
        min-width: 168px;
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
            ${renderGuidanceMarkup(classification, state)}
            <div class="pamila-actions">
              ${renderPrimaryActionMarkup(classification.status, state)}
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
  shadow.querySelectorAll<HTMLButtonElement>('[data-pamila-action="refresh"]').forEach((button) => {
    button.addEventListener("click", handlers.onRefreshFacts);
  });
  shadow.querySelector<HTMLButtonElement>('[data-pamila-action="inbox"]')?.addEventListener("click", handlers.onOpenInbox);
  shadow.querySelector<HTMLButtonElement>('[data-pamila-action="details"]')?.addEventListener("click", handlers.onOpenDetails);
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
          ? `<button class="pamila-quick-refresh" type="button" data-pamila-action="refresh">Refresh PAMILA facts</button>
             <button class="pamila-quick-inbox" type="button" data-pamila-action="inbox">Open Inbox</button>
             ${
               state.savedListing?.listingId
                 ? `<button class="pamila-quick-inbox" type="button" data-pamila-action="details">Open Details</button>`
                 : ""
             }`
          : ""
      }
    </div>
  `;
}

function renderPrimaryActionMarkup(pageStatus: HelperPageStatus, state: HelperState): string {
  if (pageStatus !== "listing_page") {
    return `<button class="pamila-button" type="button" disabled>${pageStatus === "search_page" ? "Open a listing first" : "Unsupported page"}</button>`;
  }

  if (state.saveStatus === "saved") {
    return `<button class="pamila-button" type="button" data-pamila-action="refresh">Refresh PAMILA facts</button>`;
  }

  return `<button class="pamila-button" type="button" data-pamila-action="save" ${state.saveStatus === "saving" ? "disabled" : ""}>${
    state.saveStatus === "saving" ? "Saving..." : "Save this listing to PAMILA"
  }</button>`;
}

function getQuickSaveLabel(state: HelperState): string {
  if (state.saveStatus === "saving") {
    return "Saving...";
  }

  if (state.saveStatus === "saved") {
    return "Already in PAMILA";
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

function renderGuidanceMarkup(classification: HelperPageClassification, state: HelperState): string {
  if (classification.status === "listing_page") {
    if (state.savedListing) {
      return `
        <section>
          <h3 class="pamila-section-title">Already saved</h3>
          <ul class="pamila-list">
            <li>This listing is already in PAMILA.</li>
            <li>Use Refresh PAMILA facts after ${escapeHtml(getSourceLabel(classification.source))} changes price, bedrooms, dates, or location details.</li>
            <li>${escapeHtml(state.savedListing.title)} is currently ${escapeHtml(labelize(state.savedListing.status).toLowerCase())}.</li>
            ${
              state.savedLookupSource === "cache"
                ? "<li>Saved state is from local extension cache; start the API to confirm the latest status.</li>"
                : "<li>PAMILA confirmed this against the local API.</li>"
            }
          </ul>
        </section>
      `;
    }

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

  if (classification.status === "search_page") {
    if (classification.source === "leasebreak") {
      return `
        <section>
          <h3 class="pamila-section-title">Search page guidance</h3>
          <ul class="pamila-list">
            <li>Leasebreak search pages are for browsing only; PAMILA will not batch-capture visible cards.</li>
            <li>Open one specific Leasebreak listing page, then save it from there.</li>
            <li>Check the listing page date windows before saving: earliest/latest move-in and earliest/latest move-out can change ranking.</li>
          </ul>
        </section>
      `;
    }

    return `
      <section>
        <h3 class="pamila-section-title">Search page guidance</h3>
        <ul class="pamila-list">
          <li>Search pages are noisy, so PAMILA will not batch-capture visible cards.</li>
          <li>${escapeHtml(state.searchSavedCardMessage ?? "Checking visible cards for listings already in PAMILA...")}</li>
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

function getSourceLabel(source: ListingSource | null): string {
  if (source === "airbnb") {
    return "Airbnb";
  }

  if (source === "leasebreak") {
    return "Leasebreak";
  }

  return "the source";
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
    const timeout = window.setTimeout(() => {
      resolve(null);
    }, 15_000);

    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      window.clearTimeout(timeout);
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

function dashboardListingUrl(listingId: string | null): string {
  return listingId ? `${dashboardUrl}/#listing/${encodeURIComponent(listingId)}` : dashboardInboxUrl;
}

function labelize(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function initializeAirbnbSearchBadges(state: HelperState, render: () => void): void {
  let debounceTimer: number | null = null;
  let lookupSerial = 0;

  const scheduleLookup = () => {
    if (isApplyingAirbnbSavedBadges) {
      return;
    }

    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }

    debounceTimer = window.setTimeout(() => {
      lookupSerial += 1;
      const currentSerial = lookupSerial;
      void lookupAndRenderAirbnbSearchBadges().then((result) => {
        if (currentSerial !== lookupSerial) {
          return;
        }

        state.searchSavedCardCount = result.savedCount;
        state.searchSavedCardMessage = result.message;
        render();
      });
    }, 300);
  };

  const observer = new MutationObserver(scheduleLookup);
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  window.addEventListener("scroll", scheduleLookup, { passive: true });
  scheduleLookup();
}

interface AirbnbSearchBadgeResult {
  message: string;
  savedCount: number;
  visibleCount: number;
}

async function lookupAndRenderAirbnbSearchBadges(): Promise<AirbnbSearchBadgeResult> {
  const entries = getVisibleAirbnbRoomLinkEntries();
  const urls = [...new Set(entries.map((entry) => entry.url))].slice(0, 100);

  if (urls.length === 0) {
    clearAirbnbSavedBadges();
    return {
      message: "No visible Airbnb listing cards were detected yet.",
      savedCount: 0,
      visibleCount: 0
    };
  }

  const response = await sendRuntimeMessage<SavedListingLookupResult>({
    type: helperLookupListingsMessageType,
    source: "airbnb",
    urls
  });

  if (!response) {
    return {
      message: "Could not check visible cards against PAMILA yet.",
      savedCount: 0,
      visibleCount: entries.length
    };
  }

  const savedCount = renderAirbnbSavedBadges(entries, response.matchesByUrl ?? {});
  return {
    message:
      savedCount > 0
        ? `${savedCount} visible Airbnb card${savedCount === 1 ? "" : "s"} already in PAMILA. Green badges appear on the saved card photos.`
        : `Checked ${entries.length} visible Airbnb card${entries.length === 1 ? "" : "s"}; none matched saved PAMILA listings.`,
    savedCount,
    visibleCount: entries.length
  };
}

interface AirbnbRoomLinkEntry {
  target: HTMLElement;
  url: string;
}

function getVisibleAirbnbRoomLinkEntries(): AirbnbRoomLinkEntry[] {
  const entriesByUrl = new Map<string, AirbnbRoomLinkEntry & { score: number }>();

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/rooms/"]'))) {
    const url = normalizeAirbnbRoomUrl(anchor.href);
    if (!url) {
      continue;
    }

    const target = findAirbnbBadgeTarget(anchor);
    if (!target || !isVisiblyUsefulBadgeTarget(target)) {
      continue;
    }

    const score = scoreAirbnbBadgeTarget(anchor, target);
    const existing = entriesByUrl.get(url);
    if (!existing || score > existing.score) {
      entriesByUrl.set(url, { score, target, url });
    }
  }

  return Array.from(entriesByUrl.values()).map(({ score: _score, ...entry }) => entry);
}

function normalizeAirbnbRoomUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl, window.location.href);
    const roomMatch = /\/rooms\/(\d+)/i.exec(parsed.pathname);
    return roomMatch?.[1] ? `https://www.airbnb.com/rooms/${roomMatch[1]}` : null;
  } catch {
    return null;
  }
}

function findAirbnbBadgeTarget(anchor: HTMLAnchorElement): HTMLElement | null {
  const directMediaTarget = findMediaBadgeTarget(anchor, anchor);
  if (directMediaTarget) {
    return directMediaTarget;
  }

  let current: HTMLElement | null = anchor;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const mediaTarget = findMediaBadgeTarget(current, current);
    if (mediaTarget) {
      return mediaTarget;
    }
    current = current.parentElement;
  }

  return anchor;
}

function findMediaBadgeTarget(root: HTMLElement, boundsRoot: HTMLElement): HTMLElement | null {
  const image = root.querySelector<HTMLImageElement>("img");
  if (!image) {
    return null;
  }

  const boundsRect = boundsRoot.getBoundingClientRect();
  let current = image.parentElement;
  while (current && root.contains(current)) {
    const rect = current.getBoundingClientRect();
    if (
      rect.width >= 120 &&
      rect.height >= 80 &&
      rect.width <= Math.max(boundsRect.width + 8, 160) &&
      rect.height <= Math.max(boundsRect.height * 0.86, 120)
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return image.parentElement;
}

function isVisiblyUsefulBadgeTarget(target: HTMLElement): boolean {
  const rect = target.getBoundingClientRect();
  return rect.width >= 120 && rect.height >= 80 && rect.bottom >= -200 && rect.top <= window.innerHeight + 800;
}

function scoreAirbnbBadgeTarget(anchor: HTMLAnchorElement, target: HTMLElement): number {
  const rect = target.getBoundingClientRect();
  return (
    (target.querySelector("img, picture") ? 100 : 0) +
    (anchor.querySelector("img, picture") ? 50 : 0) +
    Math.min(rect.width, 400) / 10 +
    Math.min(rect.height, 320) / 10
  );
}

function renderAirbnbSavedBadges(
  entries: AirbnbRoomLinkEntry[],
  matchesByUrl: Record<string, SavedListingSnapshot>
): number {
  isApplyingAirbnbSavedBadges = true;
  clearAirbnbSavedBadges();
  const mountedTargets = new Set<HTMLElement>();
  let savedCount = 0;

  for (const entry of entries) {
    const match = matchesByUrl[entry.url];
    if (!match || mountedTargets.has(entry.target)) {
      continue;
    }

    attachAirbnbSavedBadge(entry.target, match);
    mountedTargets.add(entry.target);
    savedCount += 1;
  }

  window.setTimeout(() => {
    isApplyingAirbnbSavedBadges = false;
  }, 0);

  return savedCount;
}

function clearAirbnbSavedBadges(): void {
  document.querySelectorAll("[data-pamila-card-badge-root='true']").forEach((element) => element.remove());
}

function attachAirbnbSavedBadge(target: HTMLElement, match: SavedListingSnapshot): void {
  const host = document.createElement("span");
  host.dataset.pamilaCardBadgeRoot = "true";
  host.style.all = "initial";
  host.style.left = "12px";
  host.style.pointerEvents = "none";
  host.style.position = "absolute";
  host.style.top = "12px";
  host.style.zIndex = "2147483646";

  const computedPosition = window.getComputedStyle(target).position;
  if (computedPosition === "static") {
    target.style.position = "relative";
  }

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .badge {
        align-items: center;
        backdrop-filter: blur(10px);
        background: rgba(255, 255, 255, 0.94);
        border: 1px solid rgba(22, 101, 52, 0.24);
        border-radius: 999px;
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.16);
        box-sizing: border-box;
        color: #14532d;
        display: inline-flex;
        gap: 6px;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 900;
        line-height: 1;
        min-height: 26px;
        padding: 7px 10px 7px 8px;
        white-space: nowrap;
      }

      .dot {
        background: #16a34a;
        border-radius: 999px;
        box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.14);
        height: 8px;
        width: 8px;
      }
    </style>
    <span class="badge" title="${escapeHtml(match.title)}"><span class="dot" aria-hidden="true"></span>In PAMILA</span>
  `;

  target.append(host);
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
  const airbnbCoordinates = source === "airbnb" ? extractCoordinates() : null;
  const visibleFields = {
    ...extractVisibleFieldsFromText(source, textForParsing),
    ...(source === "airbnb" ? extractAirbnbDomVisibleFields(textForParsing, airbnbCoordinates) : {})
  };

  return {
    source,
    url: window.location.href,
    title: truncateText(document.title, 300),
    visibleFields,
    selectedText,
    pageText,
    approxLocation: source === "airbnb" ? extractApproxAirbnbLocation(textForParsing, visibleFields, airbnbCoordinates) : null,
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
    Object.assign(fields, extractLeasebreakSourceFields(normalized));

    if (/\bimmediate\b/i.test(normalized)) {
      fields.move_in_urgency_candidate = "immediate";
    }
  }

  if (/\bmonth[-\s]?to[-\s]?month\b/i.test(normalized)) {
    fields.month_to_month_candidate = "yes";
  }

  return fields;
}

function extractAirbnbDomVisibleFields(text: string, coordinates: { lat: number; lng: number } | null): Record<string, string> {
  return {
    ...extractAirbnbMonthlyRentFields(text),
    ...extractAirbnbBedroomFields(text),
    ...extractAirbnbAvailabilityFields(text),
    ...extractAirbnbUrlAvailabilityFields(window.location.href),
    ...extractAirbnbLocationFields(text, coordinates)
  };
}

function extractAirbnbMonthlyRentFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const normalized = text.replace(/\s+/g, " ").trim();
  const monthlyPairs = Array.from(
    normalized.matchAll(
      /\$([1-9][\d,]{2,})\s*(?:(?:monthly|month|\/\s*month|mo\b)\s+)?\$([1-9][\d,]{2,})\s*(?:monthly|month|\/\s*month|mo\b)/gi
    )
  );
  const pair = monthlyPairs.find((match) => {
    const original = parseCurrencyAmount(match[1] ?? "");
    const current = parseCurrencyAmount(match[2] ?? "");
    return original !== null && current !== null && original > current && current >= 1_000 && current <= 10_000;
  });

  if (pair?.[1] && pair[2]) {
    fields.airbnb_original_monthly_rent = `$${pair[1]} monthly`;
    fields.airbnb_current_monthly_rent = `$${pair[2]} monthly`;
    fields.monthly_rent_candidate = fields.airbnb_current_monthly_rent;
    return fields;
  }

  const monthlyPrice = findFirstMatch(normalized, [
    /\$[1-9][\d,]{2,}\s*(?:monthly|month|\/\s*month|mo\b)/i,
    /\$[1-9][\d,]{2,}(?=\s+monthly\b)/i
  ]);
  if (monthlyPrice) {
    fields.airbnb_current_monthly_rent = monthlyPrice;
    fields.monthly_rent_candidate = monthlyPrice;
  }

  return fields;
}

function extractLeasebreakSourceFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const address = sanitizeFieldValue(
    text.match(/\b\d{1,5}\s+[A-Z0-9][A-Za-z0-9 .'-]{1,80}?\s(?:st|street|ave|avenue|broadway|blvd|boulevard|rd|road)\b/i)?.[0] ?? null
  );
  if (address) {
    fields.leasebreak_address = address;
    fields.location_candidate = address;
  }

  const neighborhood = detectKnownNeighborhood(text);
  if (neighborhood) {
    fields.leasebreak_neighborhood = neighborhood;
    fields.neighborhood_candidate = neighborhood;
  }

  const bedroomValue = sanitizeFieldValue(
    text.match(/\bbedrooms?\s*:?\s*(studio|[0-9]+(?:\.[0-9]+)?)(?=\s+(?:bathrooms?|decor|listing\s+type|posted\s+by|\$|earliest|last\s+updated)\b|$)/i)?.[1] ?? null
  );
  if (bedroomValue) {
    fields.leasebreak_bedroom_count = /^studio$/i.test(bedroomValue) ? "0" : bedroomValue;
    fields.bedroom_candidate = /^studio$/i.test(bedroomValue) ? "Studio" : `${bedroomValue} bedroom`;
  }

  const listingType = sanitizeFieldValue(
    text.match(
      /\blisting\s+type\s*:?\s*([a-z][a-z\s-]{2,60}?)(?=\s+(?:posted\s+by|decor|kind\s+of\s+building|opportunity|brokerage\s+fee|apartment\s+tours|virtual\s+live\s+tours|pre-recorded|features|property\s+details)\b|$)/i
    )?.[1] ?? null
  );
  if (listingType) {
    fields.leasebreak_listing_type = listingType;
    const stayType = mapLeasebreakListingTypeToStayType(listingType);
    if (stayType !== "unknown") {
      fields.stay_type_candidate = stayType;
    }
  }

  return fields;
}

function extractAirbnbBedroomFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const normalized = text.replace(/\s+/g, " ").trim();
  const summary =
    findFirstMatch(normalized, [
      /\b\d+\s+guests?\s*[·•]\s*(?:studio|\d+\s+bedrooms?)\s*[·•]\s*\d+\s+beds?\s*[·•]\s*\d+(?:\.\d+)?\s+baths?\b/i,
      /\b(?:studio|\d+\s+bedrooms?)\s*[·•]\s*\d+\s+beds?\s*[·•]\s*\d+(?:\.\d+)?\s+baths?\b/i
    ]) ?? null;
  const bedroomText = summary ?? normalized;
  const explicitBedroom = /\b([1-9]\d*)\s+bedrooms?\b/i.exec(bedroomText);

  if (explicitBedroom?.[1]) {
    fields.airbnb_bedroom_summary = summary ?? explicitBedroom[0];
    fields.airbnb_bedroom_count = explicitBedroom[1];
    fields.bedroom_candidate = `${explicitBedroom[1]} bedroom`;
    return fields;
  }

  if (/\bstudio\b/i.test(bedroomText) && !/\b\d+\s+bedrooms?\b/i.test(bedroomText)) {
    fields.airbnb_bedroom_summary = summary ?? "Studio";
    fields.airbnb_bedroom_count = "0";
    fields.bedroom_candidate = "Studio";
  }

  return fields;
}

function extractAirbnbAvailabilityFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const normalized = text.replace(/\s+/g, " ").trim();
  const monthRange = findFirstMatch(normalized, [
    /\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+\d{1,2},\s+\d{4}\s*[-–]\s*(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+\d{1,2},\s+\d{4}\b/i
  ]);
  if (monthRange) {
    fields.airbnb_availability_summary = `Available ${monthRange.replace(/\s*[-–]\s*/, " to ")}`;
    return fields;
  }

  const checkInOut = normalized.match(
    /\bcheck-?in\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+check-?out\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i
  );
  if (checkInOut?.[1] && checkInOut[2]) {
    fields.airbnb_availability_summary = `Available ${checkInOut[1]} to ${checkInOut[2]}`;
  }

  return fields;
}

function extractAirbnbUrlAvailabilityFields(url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    const checkIn = parsed.searchParams.get("check_in") ?? parsed.searchParams.get("checkin");
    const checkOut = parsed.searchParams.get("check_out") ?? parsed.searchParams.get("checkout");
    const formattedCheckIn = formatIsoDateForAvailability(checkIn);
    const formattedCheckOut = formatIsoDateForAvailability(checkOut);
    if (formattedCheckIn && formattedCheckOut) {
      return {
        airbnb_availability_summary: `Available ${formattedCheckIn} to ${formattedCheckOut}`
      };
    }
  } catch {
    return {};
  }

  return {};
}

function formatIsoDateForAvailability(value: string | null): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const year = Number(match[1]);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Number.isInteger(day) || !Number.isInteger(year)) {
    return null;
  }

  return `${months[monthIndex]} ${day}, ${year}`;
}

function extractAirbnbLocationFields(text: string, coordinates: { lat: number; lng: number } | null): Record<string, string> {
  const fields: Record<string, string> = {};
  const label = bestAirbnbLocationLabel(text, coordinates);

  if (label) {
    fields.airbnb_location_label = label;
    fields.airbnb_location_confidence = coordinates ? "medium" : "low";
    fields.airbnb_location_source = coordinates ? "airbnb_map_or_page_state" : "airbnb_visible_text";
    fields.neighborhood_candidate = label;
  }

  if (coordinates) {
    fields.airbnb_approx_lat = String(coordinates.lat);
    fields.airbnb_approx_lng = String(coordinates.lng);
    fields.airbnb_location_confidence = "medium";
    fields.airbnb_location_source = "airbnb_map_or_page_state";
  }

  return fields;
}

function parseCurrencyAmount(value: string): number | null {
  const amount = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function extractApproxAirbnbLocation(
  text: string,
  fields: Record<string, string>,
  coordinates: { lat: number; lng: number } | null
): ListingLocation | null {
  const label = bestAirbnbLocationLabel(text, coordinates, fields) ?? "Airbnb approximate location";

  if (!coordinates && label === "Airbnb approximate location") {
    return null;
  }

  const neighborhood = label === "Airbnb approximate location" ? null : label;
  return {
    label,
    address: null,
    crossStreets: null,
    neighborhood,
    geographyCategory: geographyForAirbnbLocation(label, neighborhood),
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

  if (isNycCoordinate(lat, lng)) {
    return { lat, lng };
  }

  const coordinateMatch = window.location.href.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (coordinateMatch?.[1] && coordinateMatch[2]) {
    const urlLat = Number.parseFloat(coordinateMatch[1]);
    const urlLng = Number.parseFloat(coordinateMatch[2]);
    if (isNycCoordinate(urlLat, urlLng)) {
      return {
        lat: urlLat,
        lng: urlLng
      };
    }
  }

  for (const candidate of collectCoordinateCandidateText()) {
    const coordinates = extractCoordinatesFromTextCandidate(candidate);
    if (coordinates) {
      return coordinates;
    }
  }

  return null;
}

function collectCoordinateCandidateText(): string[] {
  const candidates: string[] = [window.location.href];

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("a[href], img[src], source[srcset], iframe[src]")).slice(0, 250)) {
    const href = element.getAttribute("href");
    const src = element.getAttribute("src");
    const srcset = element.getAttribute("srcset");
    candidates.push(...[href, src, srcset].filter((value): value is string => Boolean(value)));
  }

  for (const script of Array.from(document.scripts).slice(0, 40)) {
    const text = script.textContent;
    if (text && /lat|lng|latitude|longitude|map/i.test(text)) {
      candidates.push(...extractCoordinateSnippets(text));
    }
  }

  return candidates;
}

function extractCoordinatesFromTextCandidate(value: string): { lat: number; lng: number } | null {
  const decoded = safeDecodeURIComponent(value);
  const patterns: Array<{ order: "lat_lng" | "lng_lat"; pattern: RegExp }> = [
    { order: "lat_lng", pattern: /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/ },
    { order: "lat_lng", pattern: /(?:center|markers|ll)=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)/i },
    { order: "lat_lng", pattern: /(?:center|markers|ll)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/i },
    {
      order: "lat_lng",
      pattern: /["'](?:lat|latitude)["']\s*:\s*(-?\d{1,2}\.\d+)[\s\S]{0,120}?["'](?:lng|lon|longitude)["']\s*:\s*(-?\d{1,3}\.\d+)/i
    },
    {
      order: "lng_lat",
      pattern: /["'](?:lng|lon|longitude)["']\s*:\s*(-?\d{1,3}\.\d+)[\s\S]{0,120}?["'](?:lat|latitude)["']\s*:\s*(-?\d{1,2}\.\d+)/i
    }
  ];

  for (const { order, pattern } of patterns) {
    const match = decoded.match(pattern);
    if (!match?.[1] || !match[2]) {
      continue;
    }

    const first = Number.parseFloat(match[1]);
    const second = Number.parseFloat(match[2]);
    const coordinate = order === "lng_lat" ? { lat: second, lng: first } : { lat: first, lng: second };
    if (isNycCoordinate(coordinate.lat, coordinate.lng)) {
      return coordinate;
    }
  }

  return null;
}

function safeDecodeURIComponent(value: string): string {
  if (!value.includes("%")) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractCoordinateSnippets(text: string): string[] {
  const snippets: string[] = [];
  const pattern = /lat|lng|latitude|longitude|center|markers|ll|map/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) && snippets.length < 12) {
    const start = Math.max(0, match.index - 800);
    const end = Math.min(text.length, match.index + 1_200);
    snippets.push(text.slice(start, end));
  }

  return snippets;
}

function isNycCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 40.45 && lat <= 40.95 && lng >= -74.35 && lng <= -73.65;
}

function bestAirbnbLocationLabel(
  text: string,
  coordinates: { lat: number; lng: number } | null,
  fields: Record<string, string> = {}
): string | null {
  const explicitFieldLabel = sanitizeFieldValue(fields.airbnb_location_label ?? null);
  const inferredFromCoordinates = coordinates ? inferNycNeighborhoodFromCoordinates(coordinates.lat, coordinates.lng) : null;
  const visibleNeighborhood = detectKnownNeighborhood(text);
  const visibleLabel = extractAirbnbLocationLabel(text);
  const candidates = [inferredFromCoordinates, visibleNeighborhood, explicitFieldLabel, visibleLabel].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

  for (const candidate of candidates) {
    const sanitized = sanitizeFieldValue(candidate);
    if (sanitized && !isGenericAirbnbLocationLabel(sanitized)) {
      return sanitized;
    }
  }

  return null;
}

function extractAirbnbLocationLabel(text: string): string | null {
  const match =
    text.match(/where\s+you[’']?ll\s+be\s+([^|]{3,120}?)(?=\s+(?:this listing|guests say|learn more|location is|hosted by|photos|amenities|reviews|reserve)|$)/i) ??
    text.match(/neighborhood\s+([^.,|]{3,80})/i) ??
    text.match(/location\s+([^.,|]{3,80})/i);
  const label = sanitizeFieldValue(match?.[1] ?? null);
  if (!label) {
    return null;
  }

  const neighborhood = detectKnownNeighborhood(label);
  return neighborhood ?? label.replace(/,\s*United States$/i, "").trim();
}

function isGenericAirbnbLocationLabel(label: string): boolean {
  return /^(new york|new york, united states|nyc|united states)$/i.test(label.trim());
}

function detectKnownNeighborhood(text: string): string | null {
  const lower = text.toLowerCase();
  const neighborhoods: Array<[RegExp, string]> = [
    [/\bupper west side\b|\buws\b/, "Upper West Side"],
    [/\bupper east side\b|\bues\b/, "Upper East Side"],
    [/\blong island city\b|\blic\b/, "Long Island City"],
    [/\bastoria\b/, "Astoria"],
    [/\bchelsea\b/, "Chelsea"],
    [/\bflatiron\b/, "Flatiron"],
    [/\bgramercy\b/, "Gramercy"],
    [/\bunion square\b/, "Union Square"],
    [/\bnomad\b/, "NoMad"],
    [/\bmidtown west\b|\bhell['’]s kitchen\b/, "Midtown West / Hell's Kitchen"],
    [/\bmidtown\b/, "Midtown"],
    [/\bmurray hill\b/, "Murray Hill"],
    [/\bkips bay\b/, "Kips Bay"],
    [/\beast village\b/, "East Village"],
    [/\bwest village\b/, "West Village"],
    [/\bgreenwich village\b/, "Greenwich Village"],
    [/\bsoho\b/, "SoHo"],
    [/\btribeca\b/, "Tribeca"],
    [/\blower east side\b/, "Lower East Side"],
    [/\bfinancial district\b|\bfidi\b/, "Financial District"],
    [/\bharlem\b/, "Harlem"],
    [/\bwilliamsburg\b/, "Williamsburg"],
    [/\bgreenpoint\b/, "Greenpoint"],
    [/\bdumbo\b/, "DUMBO"],
    [/\bbrooklyn heights\b/, "Brooklyn Heights"],
    [/\bdowntown brooklyn\b/, "Downtown Brooklyn"],
    [/\bfort greene\b/, "Fort Greene"],
    [/\bclinton hill\b/, "Clinton Hill"],
    [/\bpark slope\b/, "Park Slope"],
    [/\bbushwick\b/, "Bushwick"],
    [/\bbed-stuy\b|\bbedford-stuyvesant\b/, "Bed-Stuy"]
  ];

  return neighborhoods.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
}

function inferNycNeighborhoodFromCoordinates(lat: number, lng: number): string | null {
  const boxes: Array<{ label: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
    { label: "Upper West Side", minLat: 40.765, maxLat: 40.805, minLng: -73.995, maxLng: -73.955 },
    { label: "Upper East Side", minLat: 40.758, maxLat: 40.79, minLng: -73.97, maxLng: -73.935 },
    { label: "Chelsea", minLat: 40.735, maxLat: 40.755, minLng: -74.01, maxLng: -73.99 },
    { label: "Flatiron", minLat: 40.735, maxLat: 40.747, minLng: -73.997, maxLng: -73.985 },
    { label: "Astoria", minLat: 40.755, maxLat: 40.79, minLng: -73.94, maxLng: -73.895 },
    { label: "Long Island City", minLat: 40.735, maxLat: 40.765, minLng: -73.965, maxLng: -73.925 },
    { label: "Williamsburg", minLat: 40.7, maxLat: 40.73, minLng: -73.97, maxLng: -73.93 },
    { label: "Greenpoint", minLat: 40.725, maxLat: 40.745, minLng: -73.965, maxLng: -73.93 }
  ];

  return boxes.find((box) => lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng)?.label ?? null;
}

function geographyForAirbnbLocation(label: string, neighborhood: string | null): ListingLocation["geographyCategory"] {
  const lower = `${label} ${neighborhood ?? ""}`.toLowerCase();
  if (
    [
      "chelsea",
      "flatiron",
      "gramercy",
      "union square",
      "nomad",
      "midtown",
      "murray hill",
      "kips bay",
      "east village",
      "west village",
      "greenwich village",
      "soho",
      "tribeca",
      "lower east side",
      "financial district",
      "fidi",
      "upper east side",
      "upper west side",
      "harlem",
      "manhattan"
    ].some((candidate) => lower.includes(candidate))
  ) {
    return "manhattan";
  }

  if (["astoria", "long island city", "lic", "queens"].some((candidate) => lower.includes(candidate))) {
    return "lic_astoria";
  }

  if (
    [
      "williamsburg",
      "greenpoint",
      "dumbo",
      "brooklyn heights",
      "downtown brooklyn",
      "fort greene",
      "clinton hill",
      "park slope",
      "bushwick",
      "bed-stuy",
      "brooklyn"
    ].some((candidate) => lower.includes(candidate))
  ) {
    return "brooklyn";
  }

  return "unknown";
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

function mapLeasebreakListingTypeToStayType(
  listingType: string
): "entire_apartment" | "private_room" | "shared_room" | "unknown" {
  if (/\bshared\s+(?:room|bedroom)\b/i.test(listingType)) {
    return "shared_room";
  }

  if (/\b(?:private\s+)?rooms?\b|\brooms?\s+for\s+rent\b/i.test(listingType)) {
    return "private_room";
  }

  if (/\b(short\s+term\s+rental|sublet|lease\s+assignment|leasebreak|rental)\b/i.test(listingType)) {
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

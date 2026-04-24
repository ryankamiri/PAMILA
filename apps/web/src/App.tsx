import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DivIcon, LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  DEFAULT_LOCAL_PORTS,
  type CommuteRouteDetail,
  type CommuteRouteLeg
} from "@pamila/core";

import { APP_NAME } from "./appConfig";
import { defaultApiClient, PamilaApiClient, type ListingUpdateRequest } from "./apiClient";
import type {
  CaptureSuggestion,
  DashboardSettings,
  DashboardListing,
  DashboardView,
  ListingBasicsDraft,
  ListingFilters,
  ManualCommuteDraft,
  ManualListingDraft,
  ManualLocationDraft
} from "./dashboardTypes";
import {
  applyCaptureSuggestionToListing,
  applyListingFilters,
  basicsDraftToListingPatch,
  commuteDraftToSummary,
  createLocalBackupExport,
  createLocalCsvExport,
  createManualListing,
  formatDateTime,
  formatCurrency,
  formatDate,
  getDailyQueue,
  getMissingFinalistBlockers,
  getShortlist,
  labelize,
  listingToBasicsDraft,
  listingToCommuteDraft,
  listingToLocationDraft,
  locationDraftToLocation,
  markCaptureSuggestion
} from "./dashboardUtils";
import { emptyManualListingDraft, initialDashboardSnapshot } from "./mockData";

const navigationItems: Array<{ id: DashboardView; label: string }> = [
  { id: "daily", label: "Daily Queue" },
  { id: "inbox", label: "Inbox + Manual Add" },
  { id: "shortlist", label: "Shortlist" },
  { id: "detail", label: "Listing Detail" },
  { id: "commute", label: "Map/Commute" },
  { id: "settings", label: "Settings" }
];

const defaultFilters: ListingFilters = {
  hardFilterStatus: "all",
  includeFallback: initialDashboardSnapshot.settings.panicModeEnabled,
  maxRent: initialDashboardSnapshot.settings.maxMonthlyRent,
  source: "all",
  status: "all",
  text: ""
};

const RAMP_COORDINATES = {
  lat: 40.74205,
  lng: -73.99154
};

export const ONBOARDING_STORAGE_KEY = "pamila:onboarding:v1:completed";

export type OnboardingStepId =
  | "welcome"
  | "api-status"
  | "daily-queue"
  | "inbox-manual-add"
  | "listing-detail"
  | "map-commute"
  | "shortlist-panic"
  | "settings-exports"
  | "daily-use-loop";

export interface OnboardingStep {
  body: string[];
  id: OnboardingStepId;
  targetId?: string;
  targetView?: DashboardView;
  title: string;
}

export const onboardingSteps: OnboardingStep[] = [
  {
    body: [
      "PAMILA is your local apartment triage cockpit for Airbnb and Leasebreak.",
      "The point is to turn search chaos into a queue, cleanup pass, scoring view, map, and shortlist."
    ],
    id: "welcome",
    title: "Welcome to PAMILA"
  },
  {
    body: [
      "Connected to local API means you are looking at real SQLite data from your machine.",
      "Mock data means the dashboard could not reach the local API, usually because the API is not running or a local token/origin setting is mismatched."
    ],
    id: "api-status",
    targetId: "api-status",
    title: "API Status"
  },
  {
    body: [
      "Daily Queue shows the smallest useful set to review first.",
      "PAMILA prioritizes cleanup urgency, then score, and keeps rejected over-budget listings out of this queue."
    ],
    id: "daily-queue",
    targetId: "daily-queue",
    targetView: "daily",
    title: "Daily Queue"
  },
  {
    body: [
      "Inbox is where captured pages and manual listings enter PAMILA.",
      "Use it to apply cleanup suggestions and fill missing facts like dates, price, stay type, and location."
    ],
    id: "inbox-manual-add",
    targetId: "inbox-manual-add",
    targetView: "inbox",
    title: "Inbox + Manual Add"
  },
  {
    body: [
      "Listing Detail is where one listing becomes trustworthy.",
      "Confirm facts, save notes, update status, geocode the location, and enter or calculate commute."
    ],
    id: "listing-detail",
    targetId: "listing-detail",
    targetView: "detail",
    title: "Listing Detail"
  },
  {
    body: [
      "Map/Commute shows Ramp and listing pins for places with coordinates.",
      "Listings that need coordinates can be geocoded one at a time, and OTP commute calculation has manual fallback when local routing is unavailable."
    ],
    id: "map-commute",
    targetId: "map-commute",
    targetView: "commute",
    title: "Map/Commute"
  },
  {
    body: [
      "Shortlist is for serious candidates you might contact or compare closely.",
      "Panic Mode reveals fallback private rooms and loosens the search only when the main entire-apartment search is not enough."
    ],
    id: "shortlist-panic",
    targetId: "dashboard-actions",
    targetView: "shortlist",
    title: "Shortlist + Panic Mode"
  },
  {
    body: [
      "Settings holds budget, dates, commute preferences, optional AI capture analysis, and export tools.",
      "CSV is for spreadsheet comparison, JSON is your full local backup, and API health confirms the backend process is alive."
    ],
    id: "settings-exports",
    targetId: "settings-exports",
    targetView: "settings",
    title: "Settings + Exports"
  },
  {
    body: [
      "Daily loop: capture or add listings, clean facts, confirm location, check commute, shortlist, contact, reject, and export a backup.",
      "That is the whole rhythm: fewer tabs, more decisions."
    ],
    id: "daily-use-loop",
    title: "Daily Use Loop"
  }
];

export interface AppProps {
  apiClient?: PamilaApiClient;
}

type ApiConnectionState = "loading" | "connected" | "offline";

function getInitialDashboardView(): DashboardView {
  if (typeof window === "undefined") {
    return "daily";
  }

  const hashView = window.location.hash.replace(/^#/, "");
  return navigationItems.some((item) => item.id === hashView) ? (hashView as DashboardView) : "daily";
}

export function App({ apiClient = defaultApiClient }: AppProps = {}) {
  const [activeView, setActiveView] = useState<DashboardView>(() => getInitialDashboardView());
  const [listings, setListings] = useState<DashboardListing[]>(initialDashboardSnapshot.listings);
  const [settings, setSettings] = useState<DashboardSettings>(initialDashboardSnapshot.settings);
  const [filters, setFilters] = useState<ListingFilters>(defaultFilters);
  const [selectedListingId, setSelectedListingId] = useState(listings[0]?.id ?? "");
  const [draft, setDraft] = useState<ManualListingDraft>(emptyManualListingDraft);
  const [apiNotice, setApiNotice] = useState("Loading local API snapshot...");
  const [apiState, setApiState] = useState<ApiConnectionState>("loading");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
  const hasCheckedOnboardingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    apiClient
      .getDashboardSnapshot()
      .then((snapshot) => {
        if (!isMounted) {
          return;
        }

        setSettings(snapshot.settings);
        setListings(snapshot.listings);
        setSelectedListingId(snapshot.listings[0]?.id ?? "");
        setFilters((current) => ({
          ...current,
          includeFallback: snapshot.settings.panicModeEnabled,
          maxRent: snapshot.settings.maxMonthlyRent
        }));
        setApiNotice("Connected to local API.");
        setApiState("connected");
      })
      .catch(() => {
        if (isMounted) {
          setApiNotice("Local API unavailable; showing mock data.");
          setApiState("offline");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [apiClient]);

  useEffect(() => {
    if (apiState === "loading" || hasCheckedOnboardingRef.current) {
      return;
    }

    hasCheckedOnboardingRef.current = true;

    if (!hasCompletedOnboarding()) {
      setOnboardingStepIndex(0);
      setIsOnboardingOpen(true);
    }
  }, [apiState]);

  useEffect(() => {
    if (!isOnboardingOpen) {
      return;
    }

    const targetView = onboardingSteps[onboardingStepIndex]?.targetView;
    if (targetView && targetView !== activeView) {
      setActiveView(targetView);
    }
  }, [activeView, isOnboardingOpen, onboardingStepIndex]);

  useEffect(() => {
    if (!isOnboardingOpen || typeof document === "undefined") {
      return;
    }

    const targetId = onboardingSteps[onboardingStepIndex]?.targetId;
    const clearActiveTargets = () => {
      document.querySelectorAll("[data-tour-active='true']").forEach((element) => {
        element.removeAttribute("data-tour-active");
      });
    };

    clearActiveTargets();

    if (!targetId || typeof window === "undefined") {
      return clearActiveTargets;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const target = document.querySelector(`[data-tour-target="${targetId}"]`);
      target?.setAttribute("data-tour-active", "true");
      target?.scrollIntoView({
        block: "center",
        inline: "nearest"
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      clearActiveTargets();
    };
  }, [activeView, isOnboardingOpen, onboardingStepIndex]);

  const filteredListings = useMemo(() => applyListingFilters(listings, filters), [filters, listings]);
  const dailyQueue = useMemo(() => getDailyQueue(listings), [listings]);
  const shortlist = useMemo(() => getShortlist(listings), [listings]);
  const selectedListing =
    listings.find((listing) => listing.id === selectedListingId) ?? filteredListings[0] ?? listings[0];

  const stats = useMemo(
    () => ({
      fallback: listings.filter((listing) => listing.score.hardFilterStatus === "fallback_only").length,
      inbox: listings.filter((listing) => ["new", "needs_cleanup"].includes(listing.status)).length,
      shortlist: shortlist.length,
      total: listings.length
    }),
    [listings, shortlist.length]
  );

  const openOnboarding = () => {
    setOnboardingStepIndex(0);
    setIsOnboardingOpen(true);
  };

  const closeOnboarding = () => {
    setIsOnboardingOpen(false);
  };

  const finishOnboarding = () => {
    markOnboardingCompleted();
    setIsOnboardingOpen(false);
  };

  const moveOnboarding = (nextIndex: number) => {
    const clampedIndex = Math.max(0, Math.min(onboardingSteps.length - 1, nextIndex));
    const targetView = onboardingSteps[clampedIndex]?.targetView;
    if (targetView) {
      setActiveView(targetView);
    }
    setOnboardingStepIndex(clampedIndex);
  };

  const replaceListing = (updatedListing: DashboardListing) => {
    setListings((current) =>
      current.map((listing) =>
        listing.id === updatedListing.id
          ? {
              ...listing,
              ...updatedListing,
              captureReview: updatedListing.captureReview ?? listing.captureReview ?? null,
              commute: updatedListing.commute ?? listing.commute,
              lastCommuteCheckedAt:
                updatedListing.lastCommuteCheckedAt ?? listing.lastCommuteCheckedAt ?? null,
              location: updatedListing.location ?? listing.location,
              locationSourceLabel:
                updatedListing.locationSourceLabel ?? listing.locationSourceLabel ?? null,
              routeDetail: updatedListing.routeDetail ?? listing.routeDetail ?? null
            }
          : listing
      )
    );
  };

  const applyLocalListingPatch = (listingId: string, patch: ListingUpdateRequest) => {
    setListings((current) =>
      current.map((listing) =>
        listing.id === listingId
          ? mergeListingPatch(listing, patch)
          : listing
      )
    );
  };

  const saveListingPatch = async (
    listingId: string,
    patch: ListingUpdateRequest,
    successMessage: string
  ) => {
    setPendingAction("Saving listing...");

    try {
      const updatedListing = await apiClient.updateListing(listingId, patch);
      replaceListing(updatedListing);
      setApiNotice(successMessage);
      setApiState("connected");
    } catch {
      applyLocalListingPatch(listingId, patch);
      setApiNotice("Local API did not accept that update; saved it in the dashboard session.");
      setApiState("offline");
    } finally {
      setPendingAction(null);
    }
  };

  const saveSettingsPatch = async (patch: Partial<DashboardSettings>, successMessage: string) => {
    const nextSettings = {
      ...settings,
      ...patch
    };

    setSettings(nextSettings);
    setFilters((current) => ({
      ...current,
      includeFallback: nextSettings.panicModeEnabled,
      maxRent: nextSettings.maxMonthlyRent
    }));
    setPendingAction("Saving settings...");

    try {
      const savedSettings = await apiClient.updateSettings(nextSettings);
      setSettings(savedSettings);
      setFilters((current) => ({
        ...current,
        includeFallback: savedSettings.panicModeEnabled,
        maxRent: savedSettings.maxMonthlyRent
      }));
      setApiNotice(successMessage);
      setApiState("connected");
    } catch {
      setApiNotice("Local API unavailable; settings changed locally for this session.");
      setApiState("offline");
    } finally {
      setPendingAction(null);
    }
  };

  const addManualListing = async () => {
    setPendingAction("Adding listing...");

    try {
      let listing = await apiClient.createListing(draft);

      if (draft.neighborhood.trim()) {
        const locationDraft = {
          address: "",
          confidenceLabel: "neighborhood" as const,
          crossStreets: "",
          lat: "",
          lng: "",
          neighborhood: draft.neighborhood,
          sourceLabel: "captured_text" as const
        };
        const location = locationDraftToLocation(locationDraft);

        try {
          listing = await apiClient.updateListingLocation(listing.id, location, "captured_text");
        } catch {
          listing = {
            ...listing,
            location,
            locationSourceLabel: "captured_text"
          };
        }
      }

      setListings((current) => [listing, ...current]);
      setSelectedListingId(listing.id);
      setActiveView("detail");
      setDraft(emptyManualListingDraft);
      setApiNotice("Saved listing through local API.");
      setApiState("connected");
      return;
    } catch {
      setApiNotice("Could not reach local API; added listing locally only.");
      setApiState("offline");
    } finally {
      setPendingAction(null);
    }

    const listing = createManualListing(draft, listings.length);
    setListings((current) => [listing, ...current]);
    setSelectedListingId(listing.id);
    setActiveView("detail");
    setDraft(emptyManualListingDraft);
  };

  const updateStatus = (listingId: string, status: DashboardListing["status"]) => {
    void saveListingPatch(listingId, { status }, `Marked listing ${labelize(status).toLowerCase()}.`);
  };

  const saveLocation = async (
    listingId: string,
    locationDraft: ManualLocationDraft
  ) => {
    const location = locationDraftToLocation(locationDraft);
    setPendingAction("Saving location...");

    try {
      const updatedListing = await apiClient.updateListingLocation(
        listingId,
        location,
        locationDraft.sourceLabel
      );
      replaceListing(updatedListing);
      setApiNotice("Saved listing location through local API.");
      setApiState("connected");
    } catch {
      setListings((current) =>
        current.map((listing) =>
          listing.id === listingId
            ? {
                ...listing,
                location,
                locationSourceLabel: locationDraft.sourceLabel,
                updatedAt: new Date().toISOString()
              }
            : listing
        )
      );
      setApiNotice("Location saved locally until the API location route is connected.");
      setApiState("offline");
    } finally {
      setPendingAction(null);
    }
  };

  const saveCommute = async (listingId: string, commuteDraft: ManualCommuteDraft) => {
    const commute = commuteDraftToSummary(commuteDraft);
    const checkedAt = commuteDraft.lastCheckedAt || new Date().toISOString();
    setPendingAction("Saving commute...");

    try {
      const updatedListing = await apiClient.updateListingCommute(listingId, commute, checkedAt);
      replaceListing(updatedListing);
      setApiNotice("Saved manual commute through local API.");
      setApiState("connected");
    } catch {
      setListings((current) =>
        current.map((listing) =>
          listing.id === listingId
            ? {
                ...listing,
                commute,
                lastCommuteCheckedAt: checkedAt,
                updatedAt: new Date().toISOString()
              }
            : listing
        )
      );
      setApiNotice("Commute saved locally until the API commute route is connected.");
      setApiState("offline");
    } finally {
      setPendingAction(null);
    }
  };

  const geocodeLocation = async (listingId: string) => {
    setPendingAction("Geocoding location...");

    try {
      const result = await apiClient.geocodeListingLocation(listingId);
      if (result.listing) {
        replaceListing(result.listing);
      } else if (result.location) {
        setListings((current) =>
          current.map((listing) =>
            listing.id === listingId
              ? {
                  ...listing,
                  location: result.location,
                  updatedAt: new Date().toISOString()
                }
              : listing
          )
        );
      }

      setApiState("connected");
      setApiNotice(
        result.status === "ok"
          ? "Saved geocoded coordinates through local API."
          : `Geocode did not update coordinates: ${result.warnings[0] ?? labelize(result.status)}.`
      );
    } catch {
      setApiState("offline");
      setApiNotice("Local API unavailable; geocoding requires the API.");
    } finally {
      setPendingAction(null);
    }
  };

  const calculateOtpCommute = async (listingId: string) => {
    setPendingAction("Preparing route...");

    try {
      const result = await apiClient.prepareListingCommute(listingId);
      if (result.listing) {
        replaceListing(result.listing);
      }

      setApiState("connected");
      setApiNotice(
        result.status === "ok"
          ? `Saved route through local API.${result.warnings[0] ? ` ${result.warnings[0]}` : ""}`
          : `Route is not ready: ${result.warnings[0] ?? labelize(result.status)}.`
      );
    } catch {
      setApiState("offline");
      setApiNotice("Local API unavailable; route preparation requires the API.");
    } finally {
      setPendingAction(null);
    }
  };

  const applyCaptureSuggestion = async (
    listingId: string,
    suggestion: CaptureSuggestion
  ) => {
    const listing = listings.find((candidate) => candidate.id === listingId);
    if (!listing) {
      return;
    }

    const locallyApplied = markCaptureSuggestion(
      applyCaptureSuggestionToListing(listing, suggestion),
      suggestion.id,
      "applied"
    );
    replaceListing(locallyApplied);

    if (suggestion.field === "location") {
      await saveLocation(listingId, suggestion.value as ManualLocationDraft);
      return;
    }

    await saveListingPatch(
      listingId,
      suggestionToListingPatch(suggestion),
      "Applied capture suggestion through local API."
    );
    replaceListing(markCaptureSuggestion(locallyApplied, suggestion.id, "applied"));
  };

  const rejectCaptureSuggestion = (listingId: string, suggestionId: string) => {
    setListings((current) =>
      current.map((listing) =>
        listing.id === listingId ? markCaptureSuggestion(listing, suggestionId, "rejected") : listing
      )
    );
    setApiNotice("Rejected capture suggestion locally.");
  };

  const exportData = async (kind: "csv" | "json") => {
    setPendingAction(kind === "csv" ? "Exporting CSV..." : "Exporting backup...");

    try {
      if (kind === "csv") {
        const csv = await apiClient.exportListingsCsv();
        downloadTextFile("pamila-listings.csv", csv.body, csv.contentType);
      } else {
        const backup = await apiClient.exportBackupJson();
        downloadTextFile("pamila-backup.json", JSON.stringify(backup, null, 2), "application/json");
      }

      setApiNotice("Export downloaded from local API.");
      setApiState("connected");
    } catch {
      const localBody =
        kind === "csv"
          ? createLocalCsvExport(listings)
          : createLocalBackupExport({ listings, settings });
      downloadTextFile(
        kind === "csv" ? "pamila-listings-local.csv" : "pamila-backup-local.json",
        localBody,
        kind === "csv" ? "text/csv" : "application/json"
      );
      setApiNotice("Local API unavailable; downloaded a dashboard-session export.");
      setApiState("offline");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="PAMILA navigation" data-tour-target="sidebar-navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <div>
            <p className="eyebrow">Local dashboard</p>
            <h1>{APP_NAME}</h1>
          </div>
        </div>

        <nav className="nav-list">
          {navigationItems.map((item) => (
            <button
              className={activeView === item.id ? "nav-button nav-button-active" : "nav-button"}
              key={item.id}
              onClick={() => setActiveView(item.id)}
              type="button"
            >
              <span aria-hidden="true">{navIcon(item.id)}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <section className="sidebar-summary" aria-label="Search constraints">
          <p className="summary-title">Ramp search</p>
          <p>Jun 30 or Jul 1 to Sep 12</p>
          <p>{formatCurrency(settings.maxMonthlyRent)} hard cap</p>
          <p>20 min ideal, 35 min max</p>
        </section>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Apartment triage cockpit</p>
            <h2>{viewTitle(activeView)}</h2>
            <p className={`api-notice api-${apiState}`} data-tour-target="api-status">
              {pendingAction ? `${pendingAction} ` : ""}
              {apiNotice}
            </p>
          </div>
          <div className="header-actions" aria-label="Dashboard actions" data-tour-target="dashboard-actions">
            <button
              className={filters.includeFallback ? "toggle toggle-on" : "toggle"}
              onClick={() =>
                void saveSettingsPatch(
                  { panicModeEnabled: !settings.panicModeEnabled },
                  `Panic Mode ${settings.panicModeEnabled ? "disabled" : "enabled"}.`
                )
              }
              type="button"
            >
              <span aria-hidden="true">!</span>
              Panic Mode {settings.panicModeEnabled ? "On" : "Off"}
            </button>
            <button className="text-button" onClick={() => void exportData("csv")} type="button">
              <span aria-hidden="true">v</span>
              Export CSV
            </button>
            <button className="text-button" onClick={() => void exportData("json")} type="button">
              <span aria-hidden="true">J</span>
              Backup JSON
            </button>
            <button className="text-button" onClick={openOnboarding} type="button">
              <span aria-hidden="true">?</span>
              How PAMILA Works
            </button>
            <a className="text-button" href={`http://localhost:${DEFAULT_LOCAL_PORTS.api}/health`}>
              API health
            </a>
          </div>
        </header>

        <section className="stats-grid" aria-label="Dashboard summary">
          <Metric label="Listings" value={stats.total.toString()} />
          <Metric label="Inbox cleanup" value={stats.inbox.toString()} />
          <Metric label="Shortlist" value={stats.shortlist.toString()} />
          <Metric label="Fallback hidden" value={stats.fallback.toString()} />
        </section>

        {activeView === "daily" ? (
          <DailyQueueView
            listings={dailyQueue}
            onSelect={(listing) => {
              setSelectedListingId(listing.id);
              setActiveView("detail");
            }}
            onStatusChange={updateStatus}
          />
        ) : null}

        {activeView === "inbox" ? (
          <InboxView
            draft={draft}
            filters={filters}
            listings={filteredListings}
            onAddListing={addManualListing}
            onApplySuggestion={applyCaptureSuggestion}
            onDraftChange={setDraft}
            onFiltersChange={setFilters}
            onRejectSuggestion={rejectCaptureSuggestion}
            onSelect={(listing) => {
              setSelectedListingId(listing.id);
              setActiveView("detail");
            }}
            onStatusChange={updateStatus}
          />
        ) : null}

        {activeView === "shortlist" ? (
          <ListingListView
            description="Serious candidates that pass hard filters, sorted by PAMILA Score."
            emptyLabel="No shortlist candidates yet."
            listings={shortlist}
            onSelect={(listing) => {
              setSelectedListingId(listing.id);
              setActiveView("detail");
            }}
            onStatusChange={updateStatus}
            title="Ranked shortlist"
          />
        ) : null}

        {activeView === "detail" && selectedListing ? (
          <ListingDetailView
            listing={selectedListing}
            onCalculateCommute={calculateOtpCommute}
            onGeocodeLocation={geocodeLocation}
            onSaveBasics={(listingId, basicsDraft) => {
              const patch = basicsDraftToListingPatch(basicsDraft);
              const current = listings.find((candidate) => candidate.id === listingId);
              void saveListingPatch(
                listingId,
                {
                  ...patch,
                  dateWindow: {
                    ...(current?.dateWindow ?? {}),
                    ...patch.dateWindow
                  }
                },
                "Saved listing details through local API."
              );
            }}
            onSaveCommute={saveCommute}
            onSaveLocation={saveLocation}
            onStatusChange={updateStatus}
          />
        ) : null}

        {activeView === "commute" ? (
          <MapCommuteView
            listings={filteredListings}
            onCalculateCommute={calculateOtpCommute}
            onGeocodeLocation={geocodeLocation}
            onSelect={(listing) => {
              setSelectedListingId(listing.id);
              setActiveView("detail");
            }}
            settings={settings}
          />
        ) : null}

        {activeView === "settings" ? (
          <SettingsView
            onExport={exportData}
            filters={filters}
            onFiltersChange={setFilters}
            onSaveSettings={saveSettingsPatch}
            settings={settings}
            snapshotCount={filteredListings.length}
          />
        ) : null}
      </main>

      <OnboardingTour
        isOpen={isOnboardingOpen}
        onBack={() => moveOnboarding(onboardingStepIndex - 1)}
        onDismiss={closeOnboarding}
        onFinish={finishOnboarding}
        onNext={() => moveOnboarding(onboardingStepIndex + 1)}
        onSkip={finishOnboarding}
        stepIndex={onboardingStepIndex}
        steps={onboardingSteps}
      />
    </div>
  );
}

export function OnboardingTour({
  isOpen,
  onBack,
  onDismiss,
  onFinish,
  onNext,
  onSkip,
  stepIndex,
  steps
}: {
  isOpen: boolean;
  onBack: () => void;
  onDismiss: () => void;
  onFinish: () => void;
  onNext: () => void;
  onSkip: () => void;
  stepIndex: number;
  steps: OnboardingStep[];
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const step = steps[stepIndex] ?? steps[0];
  const isFirstStep = stepIndex <= 0;
  const isLastStep = stepIndex >= steps.length - 1;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onDismiss, stepIndex]);

  if (!isOpen || !step) {
    return null;
  }

  return (
    <>
      <div className="tour-backdrop" aria-hidden="true" />
      <div
        aria-describedby="pamila-onboarding-description"
        aria-labelledby="pamila-onboarding-title"
        aria-modal="true"
        className={step.targetId ? "tour-dialog" : "tour-dialog tour-dialog-centered"}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="tour-progress">
          <span>Step {stepIndex + 1} of {steps.length}</span>
          {step.targetId ? <span>Highlighted in the app</span> : <span>Overview</span>}
        </div>
        <h3 id="pamila-onboarding-title">{step.title}</h3>
        <div className="tour-body" id="pamila-onboarding-description">
          {step.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <div className="tour-actions">
          <button className="text-button" onClick={onSkip} type="button">
            <span aria-hidden="true">x</span>
            Skip
          </button>
          <div className="tour-step-actions">
            <button className="icon-button" disabled={isFirstStep} onClick={onBack} type="button">
              <span aria-hidden="true">&lt;</span>
              Back
            </button>
            {isLastStep ? (
              <button className="primary-button compact-action" onClick={onFinish} type="button">
                <span aria-hidden="true">v</span>
                Finish
              </button>
            ) : (
              <button className="primary-button compact-action" onClick={onNext} type="button">
                <span aria-hidden="true">&gt;</span>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function DailyQueueView({
  listings,
  onSelect,
  onStatusChange
}: {
  listings: DashboardListing[];
  onSelect: (listing: DashboardListing) => void;
  onStatusChange: (listingId: string, status: DashboardListing["status"]) => void;
}) {
  return (
    <section className="view-stack" data-tour-target="daily-queue">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Next best actions</p>
          <h3>Review the smallest useful set</h3>
        </div>
        <p className="section-copy">
          Prioritized by cleanup urgency first, then score. Rejected over-budget listings stay out of
          the queue.
        </p>
      </div>
      <div className="listing-grid">
        {listings.length > 0 ? (
          listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
            />
          ))
        ) : (
          <p className="empty-state">No eligible daily queue items yet.</p>
        )}
      </div>
    </section>
  );
}

function InboxView({
  draft,
  filters,
  listings,
  onAddListing,
  onApplySuggestion,
  onDraftChange,
  onFiltersChange,
  onRejectSuggestion,
  onSelect,
  onStatusChange
}: {
  draft: ManualListingDraft;
  filters: ListingFilters;
  listings: DashboardListing[];
  onAddListing: () => void | Promise<void>;
  onApplySuggestion: (listingId: string, suggestion: CaptureSuggestion) => void | Promise<void>;
  onDraftChange: (draft: ManualListingDraft) => void;
  onFiltersChange: (filters: ListingFilters) => void;
  onRejectSuggestion: (listingId: string, suggestionId: string) => void;
  onSelect: (listing: DashboardListing) => void;
  onStatusChange: (listingId: string, status: DashboardListing["status"]) => void;
}) {
  const inboxListings = listings.filter((listing) =>
    ["new", "needs_cleanup", "ready_to_review"].includes(listing.status)
  );

  return (
    <section className="two-column-view" data-tour-target="inbox-manual-add">
      <div className="view-stack">
        <FilterBar filters={filters} onFiltersChange={onFiltersChange} />
        <CaptureCleanupQueue
          listings={inboxListings}
          onApplySuggestion={onApplySuggestion}
          onRejectSuggestion={onRejectSuggestion}
          onSelect={onSelect}
        />
        <ListingListView
          description="New and partially cleaned listings from manual entry, paste import, or extension capture."
          emptyLabel="No inbox listings match the current filters."
          listings={inboxListings}
          onSelect={onSelect}
          onStatusChange={onStatusChange}
          title="Inbox"
        />
      </div>
      <ManualListingForm draft={draft} onAddListing={onAddListing} onDraftChange={onDraftChange} />
    </section>
  );
}

function CaptureCleanupQueue({
  listings,
  onApplySuggestion,
  onRejectSuggestion,
  onSelect
}: {
  listings: DashboardListing[];
  onApplySuggestion: (listingId: string, suggestion: CaptureSuggestion) => void | Promise<void>;
  onRejectSuggestion: (listingId: string, suggestionId: string) => void;
  onSelect: (listing: DashboardListing) => void;
}) {
  const cleanupListings = listings.filter(
    (listing) =>
      listing.captureReview ||
      getMissingFinalistBlockers(listing).length > 0 ||
      listing.score.cleanupActions.length > 0
  );

  if (cleanupListings.length === 0) {
    return (
      <section className="cleanup-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Capture cleanup</p>
            <h3>Nothing to clean right now</h3>
          </div>
        </div>
        <p className="empty-state">Captured listings will show suggested fields and blockers here.</p>
      </section>
    );
  }

  return (
    <section className="cleanup-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Capture cleanup</p>
          <h3>Resolve captured uncertainty</h3>
        </div>
        <p className="section-copy">
          Apply clear suggestions, reject noisy ones, and fill finalist blockers before comparing.
        </p>
      </div>

      <div className="cleanup-list">
        {cleanupListings.slice(0, 4).map((listing) => (
          <article className="cleanup-item" key={listing.id}>
            <div className="cleanup-item-header">
              <div>
                <p className="source-line">
                  <span>{labelize(listing.source)}</span>
                  <span>{labelize(listing.status)}</span>
                </p>
                <h4>{listing.captureReview?.capturedTitle ?? listing.title}</h4>
              </div>
              <button className="icon-button" onClick={() => onSelect(listing)} type="button">
                <span aria-hidden="true">#</span>
                Detail
              </button>
            </div>

            <dl className="capture-facts">
              <Fact label="Raw source" value={labelize(listing.captureReview?.source ?? listing.source)} />
              <Fact label="Raw title" value={listing.captureReview?.capturedTitle ?? listing.title} />
            </dl>

            <p className="capture-excerpt">
              {listing.captureReview?.pageExcerpt ?? "No raw capture excerpt stored yet."}
            </p>

            {listing.captureReview && Object.keys(listing.captureReview.visibleFields).length > 0 ? (
              <div className="visible-field-grid" aria-label="Captured visible fields">
                {Object.entries(listing.captureReview.visibleFields).slice(0, 6).map(([key, value]) => (
                  <Fact key={key} label={labelize(key)} value={value} />
                ))}
              </div>
            ) : null}

            <BlockerList blockers={getMissingFinalistBlockers(listing)} />

            {listing.captureReview?.suggestions.length ? (
              <div className="suggestion-list" aria-label="Capture suggestions">
                {listing.captureReview.suggestions.map((suggestion) => (
                  <div
                    className={
                      suggestion.rejected
                        ? "suggestion suggestion-muted"
                        : suggestion.applied
                          ? "suggestion suggestion-applied"
                          : "suggestion"
                    }
                    key={suggestion.id}
                  >
                    <div>
                      <strong>{suggestion.label}</strong>
                      <span>
                        {labelize(suggestion.source)} · {labelize(suggestion.confidence)}
                      </span>
                    </div>
                    <div className="suggestion-actions">
                      <button
                        className="icon-button"
                        disabled={suggestion.applied || suggestion.rejected}
                        onClick={() => void onApplySuggestion(listing.id, suggestion)}
                        type="button"
                      >
                        <span aria-hidden="true">+</span>
                        Apply
                      </button>
                      <button
                        className="icon-button"
                        disabled={suggestion.applied || suggestion.rejected}
                        onClick={() => onRejectSuggestion(listing.id, suggestion.id)}
                        type="button"
                      >
                        <span aria-hidden="true">x</span>
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No structured suggestions yet; use the detail form to clean manually.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ListingListView({
  description,
  emptyLabel,
  listings,
  onSelect,
  onStatusChange,
  title
}: {
  description: string;
  emptyLabel: string;
  listings: DashboardListing[];
  onSelect: (listing: DashboardListing) => void;
  onStatusChange: (listingId: string, status: DashboardListing["status"]) => void;
  title: string;
}) {
  return (
    <section className="view-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{listings.length} shown</p>
          <h3>{title}</h3>
        </div>
        <p className="section-copy">{description}</p>
      </div>
      {listings.length > 0 ? (
        <div className="listing-grid">
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      ) : (
        <p className="empty-state">{emptyLabel}</p>
      )}
    </section>
  );
}

function ListingCard({
  listing,
  onSelect,
  onStatusChange
}: {
  listing: DashboardListing;
  onSelect: (listing: DashboardListing) => void;
  onStatusChange: (listingId: string, status: DashboardListing["status"]) => void;
}) {
  const commute = listing.commute;

  return (
    <article className="listing-card">
      <div className="listing-card-top">
        <div>
          <p className="source-line">
            <span>{labelize(listing.source)}</span>
            <span>{labelize(listing.score.hardFilterStatus)}</span>
          </p>
          <h4>{listing.title}</h4>
        </div>
        <div className={`score-badge score-${listing.score.hardFilterStatus}`}>
          {listing.score.totalScore}
        </div>
      </div>

      <dl className="fact-grid">
        <div>
          <dt>Rent</dt>
          <dd>{formatCurrency(listing.monthlyRent)}</dd>
        </div>
        <div>
          <dt>Stay</dt>
          <dd>{labelize(listing.stayType)}</dd>
        </div>
        <div>
          <dt>Dates</dt>
          <dd>{listing.dateWindow.availabilitySummary ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Commute</dt>
          <dd>
            {commute?.totalMinutes ? `${commute.totalMinutes} min` : "Needs location"}
            {commute?.transferCount !== null && commute?.transferCount !== undefined
              ? `, ${commute.transferCount} transfers`
              : ""}
          </dd>
        </div>
      </dl>

      <p className="next-action">{listing.nextAction}</p>

      {listing.score.riskFlags.length > 0 ? (
        <ul className="flag-list" aria-label="Risk flags">
          {listing.score.riskFlags.slice(0, 3).map((flag) => (
            <li className={`flag flag-${flag.severity}`} key={flag.code}>
              {flag.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="card-actions">
        <button className="icon-button" onClick={() => onSelect(listing)} type="button">
          <span aria-hidden="true">-&gt;</span>
          Details
        </button>
        <select
          aria-label={`Status for ${listing.title}`}
          className="compact-select"
          onChange={(event) =>
            onStatusChange(listing.id, event.target.value as DashboardListing["status"])
          }
          value={listing.status}
        >
          <option value="new">New</option>
          <option value="needs_cleanup">Needs cleanup</option>
          <option value="ready_to_review">Ready</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="contacted">Contacted</option>
          <option value="waiting_for_response">Waiting</option>
          <option value="rejected_by_user">Rejected</option>
          <option value="finalist">Finalist</option>
          <option value="chosen">Chosen</option>
        </select>
        <button
          className="icon-button"
          onClick={() => onStatusChange(listing.id, "shortlisted")}
          type="button"
        >
          <span aria-hidden="true">+</span>
          Shortlist
        </button>
      </div>
    </article>
  );
}

function ListingDetailView({
  listing,
  onCalculateCommute,
  onGeocodeLocation,
  onSaveBasics,
  onSaveCommute,
  onSaveLocation,
  onStatusChange
}: {
  listing: DashboardListing;
  onCalculateCommute: (listingId: string) => void | Promise<void>;
  onGeocodeLocation: (listingId: string) => void | Promise<void>;
  onSaveBasics: (listingId: string, draft: ListingBasicsDraft) => void;
  onSaveCommute: (listingId: string, draft: ManualCommuteDraft) => void | Promise<void>;
  onSaveLocation: (listingId: string, draft: ManualLocationDraft) => void | Promise<void>;
  onStatusChange: (listingId: string, status: DashboardListing["status"]) => void;
}) {
  const [basicsDraft, setBasicsDraft] = useState(() => listingToBasicsDraft(listing));
  const [commuteDraft, setCommuteDraft] = useState(() => listingToCommuteDraft(listing));
  const [locationDraft, setLocationDraft] = useState(() => listingToLocationDraft(listing));

  useEffect(() => {
    setBasicsDraft(listingToBasicsDraft(listing));
    setCommuteDraft(listingToCommuteDraft(listing));
    setLocationDraft(listingToLocationDraft(listing));
  }, [listing]);

  return (
    <section className="detail-layout" data-tour-target="listing-detail">
      <article className="detail-main">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{labelize(listing.source)}</p>
            <h3>{listing.title}</h3>
          </div>
          <div className={`score-badge score-${listing.score.hardFilterStatus}`}>
            {listing.score.totalScore}
          </div>
        </div>

        <p className="score-explanation">{listing.score.scoreExplanation}</p>

        <BlockerList blockers={getMissingFinalistBlockers(listing)} />

        <div className="score-bars" aria-label="Score breakdown">
          <ScoreBar label="Commute" max={35} value={listing.score.commuteScore} />
          <ScoreBar label="Location" max={20} value={listing.score.locationScore} />
          <ScoreBar label="Price" max={15} value={listing.score.priceScore} />
          <ScoreBar label="Dates" max={15} value={listing.score.dateScore} />
          <ScoreBar label="Amenities" max={10} value={listing.score.amenityScore} />
          <ScoreBar label="Stay/bed" max={5} value={listing.score.stayBedroomScore} />
        </div>

        <div className="detail-actions">
          <a className="icon-button" href={listing.sourceUrl} rel="noreferrer" target="_blank">
            <span aria-hidden="true">^</span>
            Open source
          </a>
          <button
            className="icon-button"
            onClick={() => onStatusChange(listing.id, "contacted")}
            type="button"
          >
            <span aria-hidden="true">@</span>
            Mark contacted
          </button>
          <button
            className="icon-button"
            onClick={() => onStatusChange(listing.id, "rejected_by_user")}
            type="button"
          >
            <span aria-hidden="true">x</span>
            Reject
          </button>
        </div>

        <BasicsEditor
          draft={basicsDraft}
          onDraftChange={setBasicsDraft}
          onSave={() => onSaveBasics(listing.id, basicsDraft)}
        />

        <LocationEditor
          draft={locationDraft}
          listing={listing}
          onDraftChange={setLocationDraft}
          onGeocode={() => void onGeocodeLocation(listing.id)}
          onSave={() => void onSaveLocation(listing.id, locationDraft)}
        />

        <CommuteEditor
          draft={commuteDraft}
          listing={listing}
          onCalculate={() => void onCalculateCommute(listing.id)}
          onDraftChange={setCommuteDraft}
          onSave={() => void onSaveCommute(listing.id, commuteDraft)}
        />

        <CommuteRoutePanel
          listing={listing}
          onCalculateCommute={onCalculateCommute}
        />
      </article>

      <aside className="detail-side" aria-label="Listing facts">
        <h3>Decision facts</h3>
        <Fact label="Status" value={labelize(listing.status)} />
        <Fact label="Hard filter" value={labelize(listing.score.hardFilterStatus)} />
        <Fact label="Rent" value={formatCurrency(listing.monthlyRent)} />
        <Fact label="Bedroom" value={listing.bedroomLabel ?? "Unknown"} />
        <Fact label="Bathroom" value={labelize(listing.bathroomType)} />
        <Fact label="Kitchen" value={labelize(listing.kitchen)} />
        <Fact label="Washer" value={labelize(listing.washer)} />
        <Fact
          label="Dates"
          value={`${formatDate(listing.dateWindow.earliestMoveIn)} to ${formatDate(
            listing.dateWindow.latestMoveOut
          )}`}
        />
        <Fact label="Location" value={listing.location?.label ?? "Needs location"} />
        <Fact
          label="Location confidence"
          value={listing.location ? labelize(listingToLocationDraft(listing).confidenceLabel) : "Unknown"}
        />
        <Fact
          label="Location source"
          value={labelize(listing.locationSourceLabel ?? listingToLocationDraft(listing).sourceLabel)}
        />
        <Fact
          label="Commute"
          value={
            listing.commute?.routeSummary ??
            (listing.commute?.totalMinutes ? `${listing.commute.totalMinutes} min` : "Unknown")
          }
        />
        <Fact label="Walk" value={listing.commute?.walkMinutes ? `${listing.commute.walkMinutes} min` : "Unknown"} />
        <Fact
          label="Lines"
          value={listing.commute?.lineNames.length ? listing.commute.lineNames.join(", ") : "Unknown"}
        />
        <Fact
          label="Last checked"
          value={formatDateTime(listing.lastCommuteCheckedAt)}
        />

        <h3>Cleanup actions</h3>
        <ul className="plain-list">
          {listing.score.cleanupActions.length > 0 ? (
            listing.score.cleanupActions.map((item) => <li key={item.code}>{item.label}</li>)
          ) : (
            <li>No cleanup needed right now.</li>
          )}
        </ul>

        <h3>Notes</h3>
        <p className="notes">{listing.userNotes || "No notes yet."}</p>
      </aside>
    </section>
  );
}

function BasicsEditor({
  draft,
  onDraftChange,
  onSave
}: {
  draft: ListingBasicsDraft;
  onDraftChange: (draft: ListingBasicsDraft) => void;
  onSave: () => void;
}) {
  return (
    <section className="editor-panel" aria-label="Edit listing basics">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Listing basics</p>
          <h3>Edit source fields</h3>
        </div>
        <button className="primary-button compact-action" onClick={onSave} type="button">
          <span aria-hidden="true">s</span>
          Save basics
        </button>
      </div>
      <div className="form-row">
        <Field label="Title">
          <input
            onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
            value={draft.title}
          />
        </Field>
        <Field label="Source URL">
          <input
            onChange={(event) => onDraftChange({ ...draft, sourceUrl: event.target.value })}
            value={draft.sourceUrl}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Rent">
          <input
            inputMode="numeric"
            onChange={(event) => onDraftChange({ ...draft, monthlyRent: event.target.value })}
            value={draft.monthlyRent}
          />
        </Field>
        <Field label="Stay">
          <select
            onChange={(event) =>
              onDraftChange({
                ...draft,
                stayType: event.target.value as ListingBasicsDraft["stayType"]
              })
            }
            value={draft.stayType}
          >
            <option value="entire_apartment">Entire apartment</option>
            <option value="private_room">Private room</option>
            <option value="shared_room">Shared room</option>
            <option value="unknown">Unknown</option>
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Bedroom label">
          <input
            onChange={(event) => onDraftChange({ ...draft, bedroomLabel: event.target.value })}
            value={draft.bedroomLabel}
          />
        </Field>
        <Field label="Bedroom count">
          <input
            inputMode="decimal"
            onChange={(event) => onDraftChange({ ...draft, bedroomCount: event.target.value })}
            value={draft.bedroomCount}
          />
        </Field>
      </div>
      <Field label="Availability">
        <input
          onChange={(event) => onDraftChange({ ...draft, availabilitySummary: event.target.value })}
          value={draft.availabilitySummary}
        />
      </Field>
      <Field label="Notes">
        <textarea
          onChange={(event) => onDraftChange({ ...draft, userNotes: event.target.value })}
          rows={4}
          value={draft.userNotes}
        />
      </Field>
    </section>
  );
}

function LocationEditor({
  draft,
  listing,
  onDraftChange,
  onGeocode,
  onSave
}: {
  draft: ManualLocationDraft;
  listing: DashboardListing;
  onDraftChange: (draft: ManualLocationDraft) => void;
  onGeocode: () => void;
  onSave: () => void;
}) {
  return (
    <section className="editor-panel" aria-label="Manual location">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Manual location</p>
          <h3>Confirm place confidence</h3>
        </div>
        <button className="primary-button compact-action" onClick={onSave} type="button">
          <span aria-hidden="true">s</span>
          Save location
        </button>
        <button className="icon-button" onClick={onGeocode} type="button">
          <span aria-hidden="true">@</span>
          Geocode
        </button>
      </div>
      <div className="form-row">
        <Field label="Address">
          <input
            onChange={(event) => onDraftChange({ ...draft, address: event.target.value })}
            placeholder="Exact address if known"
            value={draft.address}
          />
        </Field>
        <Field label="Cross streets">
          <input
            onChange={(event) => onDraftChange({ ...draft, crossStreets: event.target.value })}
            placeholder="W 23rd St and 6th Ave"
            value={draft.crossStreets}
          />
        </Field>
      </div>
      <Field label="Neighborhood">
        <input
          onChange={(event) => onDraftChange({ ...draft, neighborhood: event.target.value })}
          placeholder="Chelsea, NoMad, LIC"
          value={draft.neighborhood}
        />
      </Field>
      <div className="form-row">
        <Field label="Latitude">
          <input
            inputMode="decimal"
            onChange={(event) => onDraftChange({ ...draft, lat: event.target.value })}
            placeholder="40.7421"
            value={draft.lat}
          />
        </Field>
        <Field label="Longitude">
          <input
            inputMode="decimal"
            onChange={(event) => onDraftChange({ ...draft, lng: event.target.value })}
            placeholder="-73.9916"
            value={draft.lng}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Confidence">
          <select
            onChange={(event) =>
              onDraftChange({
                ...draft,
                confidenceLabel: event.target.value as ManualLocationDraft["confidenceLabel"]
              })
            }
            value={draft.confidenceLabel}
          >
            <option value="exact">Exact</option>
            <option value="cross_street">Cross-street</option>
            <option value="neighborhood">Neighborhood</option>
            <option value="approximate">Approximate</option>
            <option value="unknown">Unknown</option>
          </select>
        </Field>
        <Field label="Source">
          <select
            onChange={(event) =>
              onDraftChange({
                ...draft,
                sourceLabel: event.target.value as ManualLocationDraft["sourceLabel"]
              })
            }
            value={draft.sourceLabel}
          >
            <option value="user_confirmed">User-confirmed</option>
            <option value="airbnb_approximate">Airbnb approximate</option>
            <option value="leasebreak">Leasebreak</option>
            <option value="captured_text">Captured text</option>
          </select>
        </Field>
      </div>
      <p className="subtle-copy">
        Current: {listing.location?.label ?? "Needs location"} ·{" "}
        {labelize(listing.locationSourceLabel ?? draft.sourceLabel)} ·{" "}
        {listing.location?.lat !== null && listing.location?.lng !== null && listing.location?.lat !== undefined && listing.location?.lng !== undefined
          ? `${listing.location.lat.toFixed(5)}, ${listing.location.lng.toFixed(5)}`
          : "No coordinates yet"}
      </p>
    </section>
  );
}

function CommuteEditor({
  draft,
  listing,
  onCalculate,
  onDraftChange,
  onSave
}: {
  draft: ManualCommuteDraft;
  listing: DashboardListing;
  onCalculate: () => void;
  onDraftChange: (draft: ManualCommuteDraft) => void;
  onSave: () => void;
}) {
  return (
    <section className="editor-panel" aria-label="Manual commute">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Manual commute</p>
          <h3>Record route quality</h3>
        </div>
        <button
          className="primary-button compact-action"
          onClick={() =>
            onDraftChange({
              ...draft,
              lastCheckedAt: new Date().toISOString()
            })
          }
          type="button"
        >
          <span aria-hidden="true">t</span>
          Stamp time
        </button>
        <button className="icon-button" onClick={onCalculate} type="button">
          <span aria-hidden="true">r</span>
          {routeActionLabel(listing)}
        </button>
      </div>
      <div className="form-row">
        <Field label="Minutes">
          <input
            inputMode="numeric"
            onChange={(event) => onDraftChange({ ...draft, totalMinutes: event.target.value })}
            placeholder="20"
            value={draft.totalMinutes}
          />
        </Field>
        <Field label="Transfers">
          <input
            inputMode="numeric"
            onChange={(event) => onDraftChange({ ...draft, transferCount: event.target.value })}
            placeholder="0"
            value={draft.transferCount}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Walk minutes">
          <input
            inputMode="numeric"
            onChange={(event) => onDraftChange({ ...draft, walkMinutes: event.target.value })}
            placeholder="6"
            value={draft.walkMinutes}
          />
        </Field>
        <Field label="Lines">
          <input
            onChange={(event) => onDraftChange({ ...draft, lineNames: event.target.value })}
            placeholder="N, R, W"
            value={draft.lineNames}
          />
        </Field>
      </div>
      <Field label="Route notes">
        <input
          onChange={(event) => onDraftChange({ ...draft, routeSummary: event.target.value })}
          placeholder="N/R/W to 23 St, short walk"
          value={draft.routeSummary}
        />
      </Field>
      <label className="checkbox-row">
        <input
          checked={draft.hasBusHeavyRoute}
          onChange={(event) =>
            onDraftChange({ ...draft, hasBusHeavyRoute: event.target.checked })
          }
          type="checkbox"
        />
        Bus-heavy route
      </label>
      <div className="detail-actions">
        <button className="primary-button compact-action" onClick={onSave} type="button">
          <span aria-hidden="true">s</span>
          Save commute
        </button>
        <span className="subtle-copy">
          Last checked: {formatDateTime(draft.lastCheckedAt || listing.lastCommuteCheckedAt)}
        </span>
      </div>
    </section>
  );
}

export function CommuteRoutePanel({
  listing,
  onCalculateCommute,
  onSelect
}: {
  listing: DashboardListing | null;
  onCalculateCommute?: (listingId: string) => void | Promise<void>;
  onSelect?: (listing: DashboardListing) => void;
}) {
  if (!listing) {
    return (
      <section className="route-detail-panel" aria-label="Selected commute route">
        <p className="eyebrow">Selected route</p>
        <h3>Pick a listing</h3>
        <p className="subtle-copy">Select a mapped listing or commute row to inspect one route to Ramp.</p>
      </section>
    );
  }

  const routeDetail = listing.routeDetail;
  const routeLines = routeLinesLabel(listing.commute, routeDetail);
  const approximateLocation = listing.location ? isApproximateRouteLocation(listing.location) : false;

  return (
    <section className="route-detail-panel" aria-label="Selected commute route">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Selected route</p>
          <h3>Route to Ramp</h3>
          <p className="subtle-copy">{listing.title}</p>
        </div>
        <div className="route-panel-actions">
          {onSelect ? (
            <button className="icon-button" onClick={() => onSelect(listing)} type="button">
              <span aria-hidden="true">#</span>
              Details
            </button>
          ) : null}
          {onCalculateCommute ? (
            <button
              className="primary-button compact-action"
              onClick={() => void onCalculateCommute(listing.id)}
              type="button"
            >
              <span aria-hidden="true">r</span>
              {routeActionLabel(listing)}
            </button>
          ) : null}
        </div>
      </div>

      <RouteReadinessChecklist listing={listing} />

      {approximateLocation ? (
        <p className="route-warning">
          Route uses approximate location; confirm exact address before final decision.
        </p>
      ) : null}

      <div className="route-metrics" aria-label="Route summary">
        <Metric
          label="Total"
          value={listing.commute?.totalMinutes ? `${listing.commute.totalMinutes} min` : "Unknown"}
        />
        <Metric label="Transfers" value={String(listing.commute?.transferCount ?? "?")} />
        <Metric
          label="Walk"
          value={listing.commute?.walkMinutes ? `${listing.commute.walkMinutes} min` : "Unknown"}
        />
        <Metric label="Lines" value={routeLines} />
      </div>

      {routeDetail ? (
        <>
          <p className="subtle-copy">
            Calculated {formatDateTime(routeDetail.calculatedAt)} from{" "}
            {routeDetail.originLabel ?? listing.location?.label ?? "listing"} to{" "}
            {routeDetail.destinationLabel}.
            {routeDetail.externalDirectionsUrl ? (
              <>
                {" "}
                <a href={routeDetail.externalDirectionsUrl} rel="noreferrer" target="_blank">
                  Open fallback directions
                </a>
              </>
            ) : null}
          </p>

          <div className="route-leg-list" aria-label="Route legs">
            {routeDetail.legs.length > 0 ? (
              routeDetail.legs.map((leg, index) => (
                <div className="route-leg-row" key={`${leg.mode}-${index}-${leg.fromName ?? "from"}`}>
                  <span className={`route-leg-swatch route-leg-${leg.style}`} aria-hidden="true" />
                  <span>
                    <strong>{routeLegTitle(leg)}</strong>
                    <small>{routeLegEndpoints(leg)}</small>
                    {leg.geometry.length <= 1 ? (
                      <small>No drawable geometry for this leg</small>
                    ) : null}
                  </span>
                  <span>{formatRouteLegDuration(leg.durationMinutes)}</span>
                  <span>{formatRouteLegDistance(leg.distanceMeters)}</span>
                </div>
              ))
            ) : (
              <p className="empty-state">OTP saved a route shell, but no leg details came back.</p>
            )}
          </div>
        </>
      ) : (
        <p className="empty-state">
          {routeEmptyStateCopy(listing)}
        </p>
      )}
    </section>
  );
}

function RouteReadinessChecklist({ listing }: { listing: DashboardListing }) {
  const hasLocationLabel = Boolean(listing.location?.label?.trim());
  const hasCoordinates = hasListingCoordinates(listing);
  const routeSaved = Boolean(listing.routeDetail);
  const otpState = routeSaved ? "Route saved" : hasCoordinates ? "Ready to try OTP" : "Waiting for coordinates";

  return (
    <div className="route-readiness" aria-label="Route readiness checklist">
      <RouteReadinessItem
        label="Location label"
        ok={hasLocationLabel}
        value={listing.location?.label ?? "Missing"}
      />
      <RouteReadinessItem
        label="Coordinates"
        ok={hasCoordinates}
        value={hasCoordinates ? `${listing.location.lat.toFixed(5)}, ${listing.location.lng.toFixed(5)}` : "Missing"}
      />
      <RouteReadinessItem
        label="OTP server status"
        ok={routeSaved}
        value={otpState}
      />
      <RouteReadinessItem
        label="Saved route detail"
        ok={routeSaved}
        value={routeSaved ? `Saved ${formatDateTime(listing.routeDetail?.calculatedAt ?? null)}` : "Not saved"}
      />
    </div>
  );
}

function RouteReadinessItem({
  label,
  ok,
  value
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className={`route-readiness-item ${ok ? "route-readiness-ok" : ""}`}>
      <span aria-hidden="true">{ok ? "ok" : "!"}</span>
      <strong>{label}</strong>
      <small>{value}</small>
    </div>
  );
}

function BlockerList({ blockers }: { blockers: string[] }) {
  if (blockers.length === 0) {
    return (
      <div className="blocker-list blocker-list-clear">
        <span>Finalist fields present</span>
      </div>
    );
  }

  return (
    <div className="blocker-list" aria-label="Missing finalist blockers">
      <span>Missing finalist blockers:</span>
      {blockers.map((blocker) => (
        <strong key={blocker}>{blocker}</strong>
      ))}
    </div>
  );
}

function ManualListingForm({
  draft,
  onAddListing,
  onDraftChange
}: {
  draft: ManualListingDraft;
  onAddListing: () => void | Promise<void>;
  onDraftChange: (draft: ManualListingDraft) => void;
}) {
  const canSubmit = draft.sourceUrl.trim().length > 0 || draft.title.trim().length > 0;

  return (
    <aside className="form-panel" aria-label="Manual listing form">
      <div>
        <p className="eyebrow">Manual add</p>
        <h3>Add a listing</h3>
      </div>
      <Field label="Title">
        <input
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
          placeholder="Chelsea studio near trains"
          value={draft.title}
        />
      </Field>
      <Field label="Source URL">
        <input
          onChange={(event) => onDraftChange({ ...draft, sourceUrl: event.target.value })}
          placeholder="https://..."
          value={draft.sourceUrl}
        />
      </Field>
      <div className="form-row">
        <Field label="Source">
          <select
            onChange={(event) =>
              onDraftChange({ ...draft, source: event.target.value as ManualListingDraft["source"] })
            }
            value={draft.source}
          >
            <option value="leasebreak">Leasebreak</option>
            <option value="airbnb">Airbnb</option>
          </select>
        </Field>
        <Field label="Rent">
          <input
            inputMode="numeric"
            onChange={(event) => onDraftChange({ ...draft, monthlyRent: event.target.value })}
            placeholder="3600"
            value={draft.monthlyRent}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Stay">
          <select
            onChange={(event) =>
              onDraftChange({
                ...draft,
                stayType: event.target.value as ManualListingDraft["stayType"]
              })
            }
            value={draft.stayType}
          >
            <option value="entire_apartment">Entire apartment</option>
            <option value="private_room">Private room</option>
            <option value="shared_room">Shared room</option>
            <option value="unknown">Unknown</option>
          </select>
        </Field>
        <Field label="Bedroom">
          <input
            onChange={(event) => onDraftChange({ ...draft, bedroomLabel: event.target.value })}
            placeholder="Studio"
            value={draft.bedroomLabel}
          />
        </Field>
      </div>
      <Field label="Neighborhood or cross streets">
        <input
          onChange={(event) => onDraftChange({ ...draft, neighborhood: event.target.value })}
          placeholder="NoMad, Chelsea, Court Sq"
          value={draft.neighborhood}
        />
      </Field>
      <Field label="Availability summary">
        <input
          onChange={(event) =>
            onDraftChange({ ...draft, availabilitySummary: event.target.value })
          }
          placeholder="Available Jun 30 to Sep 12"
          value={draft.availabilitySummary}
        />
      </Field>
      <Field label="Notes">
        <textarea
          onChange={(event) => onDraftChange({ ...draft, userNotes: event.target.value })}
          placeholder="What needs checking?"
          rows={4}
          value={draft.userNotes}
        />
      </Field>
      <button className="primary-button" disabled={!canSubmit} onClick={onAddListing} type="button">
        <span aria-hidden="true">+</span>
        Add to Inbox
      </button>
    </aside>
  );
}

function FilterBar({
  filters,
  onFiltersChange
}: {
  filters: ListingFilters;
  onFiltersChange: (filters: ListingFilters) => void;
}) {
  return (
    <section className="filter-bar" aria-label="Listing filters">
      <Field label="Search">
        <input
          onChange={(event) => onFiltersChange({ ...filters, text: event.target.value })}
          placeholder="Title, neighborhood, action"
          value={filters.text}
        />
      </Field>
      <Field label="Source">
        <select
          onChange={(event) =>
            onFiltersChange({ ...filters, source: event.target.value as ListingFilters["source"] })
          }
          value={filters.source}
        >
          <option value="all">All</option>
          <option value="leasebreak">Leasebreak</option>
          <option value="airbnb">Airbnb</option>
        </select>
      </Field>
      <Field label="Hard filter">
        <select
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              hardFilterStatus: event.target.value as ListingFilters["hardFilterStatus"]
            })
          }
          value={filters.hardFilterStatus}
        >
          <option value="all">All</option>
          <option value="included">Included</option>
          <option value="needs_cleanup">Needs cleanup</option>
          <option value="fallback_only">Fallback only</option>
          <option value="excluded">Excluded</option>
        </select>
      </Field>
      <Field label="Max rent">
        <input
          inputMode="numeric"
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              maxRent: Number.parseInt(event.target.value || "0", 10)
            })
          }
          value={filters.maxRent}
        />
      </Field>
    </section>
  );
}

export function MapCommuteView({
  listings,
  onCalculateCommute,
  onGeocodeLocation,
  onSelect,
  settings
}: {
  listings: DashboardListing[];
  onCalculateCommute: (listingId: string) => void | Promise<void>;
  onGeocodeLocation: (listingId: string) => void | Promise<void>;
  onSelect: (listing: DashboardListing) => void;
  settings: DashboardSettings;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<LeafletMap | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const rampLat = settings.officeLat ?? RAMP_COORDINATES.lat;
  const rampLng = settings.officeLng ?? RAMP_COORDINATES.lng;
  const withCoordinates = useMemo(() => listings.filter(hasListingCoordinates), [listings]);
  const needsCoordinates = useMemo(
    () => listings.filter((listing) => listing.location && !hasListingCoordinates(listing)),
    [listings]
  );
  const withCommute = useMemo(
    () => listings.filter((listing) => listing.location || listing.commute),
    [listings]
  );
  const defaultRouteListingId =
    listings.find((listing) => listing.routeDetail)?.id ??
    withCoordinates[0]?.id ??
    withCommute[0]?.id ??
    "";
  const [selectedRouteListingId, setSelectedRouteListingId] = useState(defaultRouteListingId);
  const selectedRouteListing =
    listings.find((listing) => listing.id === selectedRouteListingId) ??
    listings.find((listing) => listing.id === defaultRouteListingId) ??
    null;
  const selectedRouteDetail = selectedRouteListing?.routeDetail ?? null;

  useEffect(() => {
    if (!defaultRouteListingId) {
      setSelectedRouteListingId("");
      return;
    }

    if (!selectedRouteListingId || !listings.some((listing) => listing.id === selectedRouteListingId)) {
      setSelectedRouteListingId(defaultRouteListingId);
    }
  }, [defaultRouteListingId, listings, selectedRouteListingId]);

  useEffect(() => {
    let cancelled = false;
    let resizeFrame: number | null = null;

    void import("leaflet").then(({ default: Leaflet }) => {
      if (cancelled || !mapElementRef.current) {
        return;
      }

      const map =
        leafletMapRef.current ??
        Leaflet.map(mapElementRef.current, {
          scrollWheelZoom: true
        }).setView([rampLat, rampLng], 12);

      if (!leafletMapRef.current) {
        Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19
        }).addTo(map);
        leafletMapRef.current = map;
      }

      markerLayerRef.current?.remove();
      const markerLayer = Leaflet.layerGroup().addTo(map);
      markerLayerRef.current = markerLayer;
      routeLayerRef.current?.remove();
      const routeLayer = Leaflet.layerGroup().addTo(map);
      routeLayerRef.current = routeLayer;

      if (selectedRouteDetail) {
        for (const leg of selectedRouteDetail.legs) {
          if (leg.geometry.length <= 1) {
            continue;
          }

          Leaflet.polyline(leg.geometry, {
            className: "pamila-route-line",
            color: leg.color,
            dashArray: leg.dashArray ?? undefined,
            opacity: 0.9,
            weight: leg.style === "walk" ? 4 : 5
          }).addTo(routeLayer);
        }
      }

      Leaflet.marker([rampLat, rampLng], {
        icon: Leaflet.divIcon({
          className: "pamila-map-marker pamila-map-marker-ramp",
          html: "<span>Ramp</span>"
        }) as DivIcon,
        title: "Ramp NYC"
      })
        .bindPopup(`<strong>Ramp NYC</strong><br>${escapeHtml(settings.officeAddress)}`)
        .addTo(markerLayer);

      for (const listing of withCoordinates) {
        const location = listing.location;
        if (!location || location.lat === null || location.lng === null) {
          continue;
        }

        Leaflet.marker([location.lat, location.lng], {
          icon: Leaflet.divIcon({
            className: `pamila-map-marker pamila-map-marker-${listing.score.hardFilterStatus}`,
            html: `<span>${listing.score.totalScore}</span>`
          }) as DivIcon,
          title: listing.title
        })
          .bindPopup(
            `<strong>${escapeHtml(listing.title)}</strong><br>${escapeHtml(location.label)}<br>${formatCurrency(
              listing.monthlyRent
            )}`
          )
          .on("click", () => setSelectedRouteListingId(listing.id))
          .addTo(markerLayer);
      }

      const routeBoundsPoints = selectedRouteDetail?.legs.flatMap((leg) => leg.geometry) ?? [];
      const boundsPoints = [
        [rampLat, rampLng] as [number, number],
        ...withCoordinates.flatMap((listing): Array<[number, number]> => {
          const location = listing.location;
          return location?.lat !== null && location?.lng !== null && location?.lat !== undefined && location?.lng !== undefined
            ? [[location.lat, location.lng]]
            : [];
        }),
        ...routeBoundsPoints
      ];

      resizeFrame = window.requestAnimationFrame(() => {
        map.invalidateSize();

        if (boundsPoints.length > 1) {
          map.fitBounds(Leaflet.latLngBounds(boundsPoints), {
            maxZoom: 14,
            padding: [24, 24]
          });
        } else {
          map.setView([rampLat, rampLng], 12);
        }
      });
    });

    return () => {
      cancelled = true;
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      markerLayerRef.current?.remove();
      markerLayerRef.current = null;
      routeLayerRef.current?.remove();
      routeLayerRef.current = null;
    };
  }, [rampLat, rampLng, selectedRouteDetail, settings.officeAddress, withCoordinates]);

  return (
    <section className="view-stack" data-tour-target="map-commute">
      <div className="section-heading">
        <div>
          <p className="eyebrow">OSM map and route board</p>
          <h3>Listings around Ramp</h3>
        </div>
        <p className="section-copy">
          Free OpenStreetMap tiles with attribution. Geocode one listing at a time, then calculate
          transit with local OTP when your graph is running.
        </p>
      </div>

      <article className="map-panel" aria-label="OpenStreetMap listing pins">
        <div className="leaflet-map" data-testid="pamila-osm-map" ref={mapElementRef} />
        <div className="map-overlay">
          <Metric label="Pins" value={withCoordinates.length.toString()} />
          <Metric label="Need coords" value={needsCoordinates.length.toString()} />
          <Metric label="Ramp" value="28 W 23rd" />
        </div>
      </article>

      <CommuteRoutePanel
        listing={selectedRouteListing}
        onCalculateCommute={onCalculateCommute}
        onSelect={onSelect}
      />

      {needsCoordinates.length > 0 ? (
        <section className="needs-coordinates" aria-label="Listings needing coordinates">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Needs coordinates</p>
              <h3>Geocode before OTP</h3>
            </div>
          </div>
          <div className="coordinate-list">
            {needsCoordinates.slice(0, 6).map((listing) => (
              <button
                className="coordinate-row"
                key={listing.id}
                onClick={() => void onGeocodeLocation(listing.id)}
                type="button"
              >
                <span>
                  <strong>{listing.title}</strong>
                  <small>{listing.location?.label ?? "Location saved without coordinates"}</small>
                </span>
                <span>Geocode</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {withCommute.length > 0 ? (
        <div className="commute-table" aria-label="Commute summaries">
          {withCommute.map((listing) => (
            <button
              aria-pressed={selectedRouteListing?.id === listing.id}
              className={`commute-row ${selectedRouteListing?.id === listing.id ? "commute-row-active" : ""}`}
              key={listing.id}
              onClick={() => setSelectedRouteListingId(listing.id)}
              type="button"
            >
              <span>
                <strong>{listing.title}</strong>
                <small>
                  {listing.location?.label ?? "Needs location"}
                  {hasListingCoordinates(listing) ? " · mapped" : " · needs coordinates"}
                </small>
              </span>
              <span>{listing.commute?.totalMinutes ? `${listing.commute.totalMinutes} min` : "No time"}</span>
              <span>{listing.commute?.transferCount ?? "?"} transfers</span>
              <span>{listing.commute?.walkMinutes ? `${listing.commute.walkMinutes} min walk` : "walk ?"}</span>
              <span>{listing.routeDetail ? "Route saved" : listing.commute?.hasBusHeavyRoute ? "Bus-heavy" : "Rail/walk"}</span>
              <span
                className="inline-action"
                onClick={(event) => {
                  event.stopPropagation();
                  void onCalculateCommute(listing.id);
                }}
              >
                {routeActionLabel(listing)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-state">Add a location or manual commute to see listings here.</p>
      )}
    </section>
  );
}

function SettingsView({
  filters,
  onExport,
  onFiltersChange,
  onSaveSettings,
  settings,
  snapshotCount
}: {
  filters: ListingFilters;
  onExport: (kind: "csv" | "json") => void | Promise<void>;
  onFiltersChange: (filters: ListingFilters) => void;
  onSaveSettings: (patch: Partial<DashboardSettings>, successMessage: string) => void | Promise<void>;
  settings: DashboardSettings;
  snapshotCount: number;
}) {
  const [settingsDraft, setSettingsDraft] = useState({
    acceptableCommuteMinutes: String(settings.acceptableCommuteMinutes),
    aiOnCaptureEnabled: settings.aiOnCaptureEnabled ?? false,
    defaultBedroomFilter: settings.defaultBedroomFilter,
    idealCommuteMinutes: String(settings.idealCommuteMinutes),
    longWalkMinutes: String(settings.longWalkMinutes),
    maxMonthlyRent: String(settings.maxMonthlyRent),
    officeAddress: settings.officeAddress,
    officeName: settings.officeName,
    panicModeEnabled: settings.panicModeEnabled,
    targetEnd: settings.targetEnd,
    targetStartPrimary: settings.targetStartPrimary,
    targetStartSecondary: settings.targetStartSecondary
  });

  useEffect(() => {
    setSettingsDraft({
      acceptableCommuteMinutes: String(settings.acceptableCommuteMinutes),
      aiOnCaptureEnabled: settings.aiOnCaptureEnabled ?? false,
      defaultBedroomFilter: settings.defaultBedroomFilter,
      idealCommuteMinutes: String(settings.idealCommuteMinutes),
      longWalkMinutes: String(settings.longWalkMinutes),
      maxMonthlyRent: String(settings.maxMonthlyRent),
      officeAddress: settings.officeAddress,
      officeName: settings.officeName,
      panicModeEnabled: settings.panicModeEnabled,
      targetEnd: settings.targetEnd,
      targetStartPrimary: settings.targetStartPrimary,
      targetStartSecondary: settings.targetStartSecondary
    });
  }, [settings]);

  return (
    <section className="settings-grid" data-tour-target="settings-exports">
      <article className="settings-panel">
        <p className="eyebrow">Default search profile</p>
        <h3>Search defaults</h3>
        <div className="form-row">
          <Field label="Office name">
            <input
              onChange={(event) =>
                setSettingsDraft({ ...settingsDraft, officeName: event.target.value })
              }
              value={settingsDraft.officeName}
            />
          </Field>
          <Field label="Budget cap">
            <input
              inputMode="numeric"
              onChange={(event) =>
                setSettingsDraft({ ...settingsDraft, maxMonthlyRent: event.target.value })
              }
              value={settingsDraft.maxMonthlyRent}
            />
          </Field>
        </div>
        <Field label="Office address">
          <input
            onChange={(event) =>
              setSettingsDraft({ ...settingsDraft, officeAddress: event.target.value })
            }
            value={settingsDraft.officeAddress}
          />
        </Field>
        <div className="form-row">
          <Field label="Primary start">
            <input
              onChange={(event) =>
                setSettingsDraft({ ...settingsDraft, targetStartPrimary: event.target.value })
              }
              type="date"
              value={settingsDraft.targetStartPrimary}
            />
          </Field>
          <Field label="Secondary start">
            <input
              onChange={(event) =>
                setSettingsDraft({ ...settingsDraft, targetStartSecondary: event.target.value })
              }
              type="date"
              value={settingsDraft.targetStartSecondary}
            />
          </Field>
        </div>
        <div className="form-row">
          <Field label="End date">
            <input
              onChange={(event) =>
                setSettingsDraft({ ...settingsDraft, targetEnd: event.target.value })
              }
              type="date"
              value={settingsDraft.targetEnd}
            />
          </Field>
          <Field label="Bedroom default">
            <select
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  defaultBedroomFilter: event.target.value as DashboardSettings["defaultBedroomFilter"]
                })
              }
              value={settingsDraft.defaultBedroomFilter}
            >
              <option value="studio_or_1br">Studio or 1BR</option>
              <option value="studio_only">Studio only</option>
              <option value="studio_plus">Studio+</option>
              <option value="one_bedroom_only">1BR only</option>
              <option value="exactly_two_bedrooms">Only 2BR</option>
              <option value="any_entire_place">Any entire place</option>
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Ideal commute">
            <input
              inputMode="numeric"
              onChange={(event) =>
                setSettingsDraft({ ...settingsDraft, idealCommuteMinutes: event.target.value })
              }
              value={settingsDraft.idealCommuteMinutes}
            />
          </Field>
          <Field label="Acceptable commute">
            <input
              inputMode="numeric"
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  acceptableCommuteMinutes: event.target.value
                })
              }
              value={settingsDraft.acceptableCommuteMinutes}
            />
          </Field>
        </div>
        <Field label="Long walk threshold">
          <input
            inputMode="numeric"
            onChange={(event) =>
              setSettingsDraft({ ...settingsDraft, longWalkMinutes: event.target.value })
            }
            value={settingsDraft.longWalkMinutes}
          />
        </Field>
        <label className="checkbox-row">
          <input
            checked={settingsDraft.panicModeEnabled}
            onChange={(event) =>
              setSettingsDraft({ ...settingsDraft, panicModeEnabled: event.target.checked })
            }
            type="checkbox"
          />
          Panic/Fallback Mode
        </label>
        <label className="checkbox-row">
          <input
            checked={settingsDraft.aiOnCaptureEnabled}
            onChange={(event) =>
              setSettingsDraft({ ...settingsDraft, aiOnCaptureEnabled: event.target.checked })
            }
            type="checkbox"
          />
          LLM capture analysis
        </label>
        <button
          className="primary-button"
          onClick={() =>
            void onSaveSettings(
              {
                acceptableCommuteMinutes: parseIntegerDraft(settingsDraft.acceptableCommuteMinutes, settings.acceptableCommuteMinutes),
                aiOnCaptureEnabled: settingsDraft.aiOnCaptureEnabled,
                defaultBedroomFilter: settingsDraft.defaultBedroomFilter,
                idealCommuteMinutes: parseIntegerDraft(settingsDraft.idealCommuteMinutes, settings.idealCommuteMinutes),
                longWalkMinutes: parseIntegerDraft(settingsDraft.longWalkMinutes, settings.longWalkMinutes),
                maxMonthlyRent: parseIntegerDraft(settingsDraft.maxMonthlyRent, settings.maxMonthlyRent),
                officeAddress: settingsDraft.officeAddress,
                officeName: settingsDraft.officeName,
                panicModeEnabled: settingsDraft.panicModeEnabled,
                targetEnd: settingsDraft.targetEnd,
                targetStartPrimary: settingsDraft.targetStartPrimary,
                targetStartSecondary: settingsDraft.targetStartSecondary
              },
              "Saved settings through local API."
            )
          }
          type="button"
        >
          <span aria-hidden="true">s</span>
          Save settings
        </button>
      </article>

      <article className="settings-panel">
        <p className="eyebrow">Local API contract</p>
        <h3>Exports and session state</h3>
        <p className="section-copy">
          Export buttons use the API when it is online, then fall back to the current dashboard
          session so you can still compare listings offline.
        </p>
        <dl className="settings-list">
          <Fact label="Base URL" value={`http://localhost:${DEFAULT_LOCAL_PORTS.api}`} />
          <Fact label="Client" value={defaultApiClient.constructor.name} />
          <Fact label="Visible after filters" value={snapshotCount.toString()} />
          <Fact label="Current budget" value={formatCurrency(settings.maxMonthlyRent)} />
          <Fact label="Current dates" value={`${formatDate(settings.targetStartPrimary)} to ${formatDate(settings.targetEnd)}`} />
        </dl>
        <div className="detail-actions">
          <button className="text-button" onClick={() => void onExport("csv")} type="button">
            <span aria-hidden="true">v</span>
            Export CSV
          </button>
          <button className="text-button" onClick={() => void onExport("json")} type="button">
            <span aria-hidden="true">J</span>
            Backup JSON
          </button>
        </div>
        <FilterBar filters={filters} onFiltersChange={onFiltersChange} />
      </article>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ScoreBar({ label, max, value }: { label: string; max: number; value: number }) {
  const width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;

  return (
    <div className="score-row">
      <span>{label}</span>
      <div className="score-track">
        <div className="score-fill" style={{ width }} />
      </div>
      <strong>
        {value}/{max}
      </strong>
    </div>
  );
}

function navIcon(view: DashboardView): string {
  switch (view) {
    case "daily":
      return ">";
    case "inbox":
      return "+";
    case "shortlist":
      return "*";
    case "detail":
      return "#";
    case "commute":
      return "~";
    case "settings":
      return "=";
  }
}

function viewTitle(view: DashboardView): string {
  switch (view) {
    case "daily":
      return "Daily Queue";
    case "inbox":
      return "Inbox and Manual Add";
    case "shortlist":
      return "Shortlist";
    case "detail":
      return "Listing Detail";
    case "commute":
      return "Map and Commute";
    case "settings":
      return "Settings";
  }
}

function mergeListingPatch(
  listing: DashboardListing,
  patch: ListingUpdateRequest
): DashboardListing {
  return {
    ...listing,
    ...patch,
    dateWindow: patch.dateWindow
      ? {
          ...listing.dateWindow,
          ...patch.dateWindow
        }
      : listing.dateWindow,
    score: listing.score,
    updatedAt: new Date().toISOString()
  };
}

function suggestionToListingPatch(suggestion: CaptureSuggestion): ListingUpdateRequest {
  switch (suggestion.field) {
    case "availabilitySummary":
      return {
        dateWindow: {
          availabilitySummary: String(suggestion.value)
        }
      };
    case "bedroomLabel":
      return {
        bedroomLabel: String(suggestion.value)
      };
    case "monthlyRent":
      return {
        monthlyRent:
          typeof suggestion.value === "number"
            ? suggestion.value
            : Number.parseInt(String(suggestion.value).replace(/[^\d]/g, ""), 10)
      };
    case "stayType":
      return {
        stayType: suggestion.value as DashboardListing["stayType"]
      };
    case "userNotes":
      return {
        userNotes: String(suggestion.value)
      };
    case "location":
      return {};
  }
}

function routeLinesLabel(
  commute: DashboardListing["commute"],
  routeDetail: CommuteRouteDetail | null
) {
  const lines =
    commute?.lineNames.length
      ? commute.lineNames
      : routeDetail?.legs
          .map((leg) => leg.lineName)
          .filter((line): line is string => Boolean(line)) ?? [];

  return lines.length > 0 ? [...new Set(lines)].join(", ") : "Walk";
}

function routeActionLabel(listing: DashboardListing) {
  if (listing.routeDetail) {
    return "Recalculate route";
  }

  if (!listing.location) {
    return "Add or accept approximate location first";
  }

  if (!hasListingCoordinates(listing)) {
    return "Geocode then calculate route";
  }

  return "Calculate route with OTP";
}

function routeEmptyStateCopy(listing: DashboardListing) {
  if (!listing.location) {
    return "No saved route detail yet. Add or accept approximate location first, then prepare the route.";
  }

  if (!hasListingCoordinates(listing)) {
    return "No saved route detail yet. Geocode this listing, then calculate transit with local OTP.";
  }

  return "No saved route detail yet. Calculate this listing with local OTP, or keep using the manual commute fields above.";
}

function isApproximateRouteLocation(location: NonNullable<DashboardListing["location"]>) {
  return (
    location.source === "airbnb_approx_pin" ||
    location.source === "neighborhood" ||
    location.confidence === "low"
  );
}

function routeLegTitle(leg: CommuteRouteLeg) {
  const modeLabel = labelize(leg.mode.toLowerCase());
  if (leg.lineName) {
    return `${modeLabel} ${leg.lineName}`;
  }
  if (leg.routeLongName) {
    return `${modeLabel} ${leg.routeLongName}`;
  }
  return modeLabel;
}

function routeLegEndpoints(leg: CommuteRouteLeg) {
  const from = leg.fromName ?? "origin";
  const to = leg.toName ?? "next stop";
  return `${from} to ${to}`;
}

function formatRouteLegDuration(minutes: number | null) {
  return minutes === null ? "time ?" : `${minutes} min`;
}

function formatRouteLegDistance(distanceMeters: number | null) {
  if (distanceMeters === null) {
    return "distance ?";
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1609.34).toFixed(1)} mi`;
}

function hasListingCoordinates(
  listing: DashboardListing
): listing is DashboardListing & { location: NonNullable<DashboardListing["location"]> & { lat: number; lng: number } } {
  return (
    listing.location !== null &&
    typeof listing.location.lat === "number" &&
    Number.isFinite(listing.location.lat) &&
    typeof listing.location.lng === "number" &&
    Number.isFinite(listing.location.lng)
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadTextFile(fileName: string, body: string, contentType: string) {
  if (typeof document === "undefined") {
    return;
  }

  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function hasCompletedOnboarding() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function markOnboardingCompleted() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
  } catch {
    // The tour still works when localStorage is unavailable; it just will not persist completion.
  }
}

function parseIntegerDraft(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

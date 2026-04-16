import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_LOCAL_PORTS } from "@pamila/core";

import { APP_NAME } from "./appConfig";
import { defaultApiClient } from "./apiClient";
import type {
  DashboardListing,
  DashboardView,
  ListingFilters,
  ManualListingDraft
} from "./dashboardTypes";
import {
  applyListingFilters,
  createManualListing,
  formatCurrency,
  formatDate,
  getDailyQueue,
  getShortlist,
  labelize
} from "./dashboardUtils";
import { emptyManualListingDraft, initialDashboardSnapshot } from "./mockData";

const navigationItems: Array<{ id: DashboardView; label: string }> = [
  { id: "daily", label: "Daily Queue" },
  { id: "inbox", label: "Inbox" },
  { id: "shortlist", label: "Shortlist" },
  { id: "detail", label: "Listing Detail" },
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

export function App() {
  const [activeView, setActiveView] = useState<DashboardView>("daily");
  const [listings, setListings] = useState<DashboardListing[]>(initialDashboardSnapshot.listings);
  const [settings, setSettings] = useState(initialDashboardSnapshot.settings);
  const [filters, setFilters] = useState<ListingFilters>(defaultFilters);
  const [selectedListingId, setSelectedListingId] = useState(listings[0]?.id ?? "");
  const [draft, setDraft] = useState<ManualListingDraft>(emptyManualListingDraft);
  const [apiNotice, setApiNotice] = useState("Using mock data until the local API is available.");

  useEffect(() => {
    let isMounted = true;

    defaultApiClient
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
      })
      .catch(() => {
        if (isMounted) {
          setApiNotice("Local API unavailable; showing mock data.");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

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

  const addManualListing = async () => {
    try {
      const listing = await defaultApiClient.createListing(draft);
      setListings((current) => [listing, ...current]);
      setSelectedListingId(listing.id);
      setActiveView("detail");
      setDraft(emptyManualListingDraft);
      setApiNotice("Saved listing through local API.");
      return;
    } catch {
      setApiNotice("Could not reach local API; added listing locally only.");
    }

    const listing = createManualListing(draft, listings.length);
    setListings((current) => [listing, ...current]);
    setSelectedListingId(listing.id);
    setActiveView("detail");
    setDraft(emptyManualListingDraft);
  };

  const updateStatus = (listingId: string, status: DashboardListing["status"]) => {
    setListings((current) =>
      current.map((listing) =>
        listing.id === listingId
          ? {
              ...listing,
              status,
              updatedAt: new Date().toISOString()
            }
          : listing
      )
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="PAMILA navigation">
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
            <p className="api-notice">{apiNotice}</p>
          </div>
          <div className="header-actions" aria-label="Dashboard actions">
            <button
              className={filters.includeFallback ? "toggle toggle-on" : "toggle"}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  includeFallback: !current.includeFallback
                }))
              }
              type="button"
            >
              <span aria-hidden="true">!</span>
              Panic Mode {filters.includeFallback ? "On" : "Off"}
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
            onDraftChange={setDraft}
            onFiltersChange={setFilters}
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
          <ListingDetailView listing={selectedListing} onStatusChange={updateStatus} />
        ) : null}

        {activeView === "settings" ? (
          <SettingsView
            filters={filters}
            onFiltersChange={setFilters}
            settings={settings}
            snapshotCount={filteredListings.length}
          />
        ) : null}
      </main>
    </div>
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
    <section className="view-stack">
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
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            onSelect={onSelect}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>
    </section>
  );
}

function InboxView({
  draft,
  filters,
  listings,
  onAddListing,
  onDraftChange,
  onFiltersChange,
  onSelect,
  onStatusChange
}: {
  draft: ManualListingDraft;
  filters: ListingFilters;
  listings: DashboardListing[];
  onAddListing: () => void;
  onDraftChange: (draft: ManualListingDraft) => void;
  onFiltersChange: (filters: ListingFilters) => void;
  onSelect: (listing: DashboardListing) => void;
  onStatusChange: (listingId: string, status: DashboardListing["status"]) => void;
}) {
  const inboxListings = listings.filter((listing) =>
    ["new", "needs_cleanup", "ready_to_review"].includes(listing.status)
  );

  return (
    <section className="two-column-view">
      <div className="view-stack">
        <FilterBar filters={filters} onFiltersChange={onFiltersChange} />
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
  onStatusChange
}: {
  listing: DashboardListing;
  onStatusChange: (listingId: string, status: DashboardListing["status"]) => void;
}) {
  return (
    <section className="detail-layout">
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
          label="Commute"
          value={
            listing.commute?.routeSummary ??
            (listing.commute?.totalMinutes ? `${listing.commute.totalMinutes} min` : "Unknown")
          }
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

function SettingsView({
  filters,
  onFiltersChange,
  settings,
  snapshotCount
}: {
  filters: ListingFilters;
  onFiltersChange: (filters: ListingFilters) => void;
  settings: typeof initialDashboardSnapshot.settings;
  snapshotCount: number;
}) {
  return (
    <section className="settings-grid">
      <article className="settings-panel">
        <p className="eyebrow">Default search profile</p>
        <h3>{settings.officeName}</h3>
        <p className="section-copy">{settings.officeAddress}</p>
        <dl className="settings-list">
          <Fact label="Primary start" value={formatDate(settings.targetStartPrimary)} />
          <Fact label="Secondary start" value={formatDate(settings.targetStartSecondary)} />
          <Fact label="End date" value={formatDate(settings.targetEnd)} />
          <Fact label="Budget cap" value={formatCurrency(settings.maxMonthlyRent)} />
          <Fact label="Bedrooms" value={labelize(settings.defaultBedroomFilter)} />
          <Fact label="Normal stay" value={labelize(settings.normalStayType)} />
          <Fact label="Fallback stay" value={labelize(settings.fallbackStayType)} />
          <Fact label="Commute target" value={`${settings.idealCommuteMinutes}-${settings.acceptableCommuteMinutes} min`} />
          <Fact label="Walk penalty" value={`${settings.longWalkMinutes}+ min`} />
        </dl>
      </article>

      <article className="settings-panel">
        <p className="eyebrow">Local API contract</p>
        <h3>Ready for backend wiring</h3>
        <p className="section-copy">
          The web lane exposes a typed client for the planned routes and currently renders with mock
          data until the API worker is integrated.
        </p>
        <dl className="settings-list">
          <Fact label="Base URL" value={`http://localhost:${DEFAULT_LOCAL_PORTS.api}`} />
          <Fact label="Client" value={defaultApiClient.constructor.name} />
          <Fact label="Visible after filters" value={snapshotCount.toString()} />
        </dl>
        <button
          className={filters.includeFallback ? "toggle toggle-on" : "toggle"}
          onClick={() => onFiltersChange({ ...filters, includeFallback: !filters.includeFallback })}
          type="button"
        >
          <span aria-hidden="true">!</span>
          Panic Mode {filters.includeFallback ? "On" : "Off"}
        </button>
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
    case "settings":
      return "Settings";
  }
}

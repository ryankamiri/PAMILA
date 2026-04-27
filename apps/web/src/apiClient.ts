import {
  DEFAULT_LOCAL_PORTS,
  type CapturePayload,
  type CommuteRouteDetail,
  type CommuteSummary,
  type ListingDateWindow,
  type ListingLocation,
  type ScoreBreakdown,
} from "@pamila/core";

import type {
  CaptureReview,
  CalculateCommuteResult,
  ClearListingHistoryResult,
  DashboardListing,
  DashboardSnapshot,
  DashboardSettings,
  GeocodeListingResult,
  ListingsCsvExport,
  ListingsJsonExport,
  ManualListingDraft,
  LocationSourceLabel,
  PrepareCommuteResult,
  PruneDeadLinksResult
} from "./dashboardTypes";

export interface PamilaApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface RecalculateScoresResult {
  updatedCount: number;
  listings: DashboardListing[];
}

export interface CreateListingRequest extends ManualListingDraft {}

export type ListingUpdateRequest = Partial<
  Omit<DashboardListing, "dateWindow" | "score" | "captureReview" | "routeDetail">
> & {
  dateWindow?: Partial<ListingDateWindow>;
};

interface ApiListingRecord {
  id: string;
  source: DashboardListing["source"];
  sourceUrl: string;
  title: string;
  monthlyRent: number | null;
  status: DashboardListing["status"];
  stayType: DashboardListing["stayType"];
  bedroomCount: number | null;
  bedroomLabel: string | null;
  bathroomType: DashboardListing["bathroomType"];
  kitchen: DashboardListing["kitchen"];
  washer: DashboardListing["washer"];
  furnished: DashboardListing["furnished"];
  availabilitySummary: string | null;
  earliestMoveIn: string | null;
  latestMoveIn: string | null;
  earliestMoveOut: string | null;
  latestMoveOut: string | null;
  monthToMonth: boolean;
  nextAction: string | null;
  userNotes: string | null;
  createdAt: string;
  updatedAt: string;
  scoreBreakdown: ScoreBreakdown | null;
  location?: ListingLocation | null;
  locationSourceLabel?: LocationSourceLabel | null;
  commute?: (CommuteSummary & { routeDetail?: CommuteRouteDetail | null }) | null;
  commuteEstimate?: (CommuteSummary & { routeDetail?: CommuteRouteDetail | null }) | null;
  routeDetail?: CommuteRouteDetail | null;
  lastCommuteCheckedAt?: string | null;
  captureReview?: CaptureReview | null;
}

export class PamilaApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly token: string | null;

  constructor(options: PamilaApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? `http://localhost:${DEFAULT_LOCAL_PORTS.api}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.token = options.token ?? null;
  }

  async getSettings(): Promise<DashboardSettings> {
    const response = await this.request<{ settings: DashboardSettings }>("/api/settings");
    return response.settings;
  }

  async updateSettings(settings: DashboardSettings): Promise<DashboardSettings> {
    const response = await this.request<{ settings: DashboardSettings }>("/api/settings", {
      body: JSON.stringify(settings),
      method: "PUT"
    });
    return response.settings;
  }

  async listListings(): Promise<DashboardListing[]> {
    const response = await this.request<{ listings: ApiListingRecord[] }>("/api/listings");
    return response.listings.map(mapApiListing);
  }

  async createListing(draft: CreateListingRequest): Promise<DashboardListing> {
    const response = await this.request<{ listing: ApiListingRecord }>("/api/listings", {
      body: JSON.stringify(toCreateListingBody(draft)),
      method: "POST"
    });
    return mapApiListing(response.listing);
  }

  async updateListing(
    id: string,
    patch: ListingUpdateRequest
  ): Promise<DashboardListing> {
    const response = await this.request<{ listing: ApiListingRecord }>(`/api/listings/${encodeURIComponent(id)}`, {
      body: JSON.stringify(toUpdateListingBody(patch)),
      method: "PATCH"
    });
    return mapApiListing(response.listing);
  }

  async updateListingLocation(
    id: string,
    location: ListingLocation | null,
    sourceLabel?: LocationSourceLabel | null
  ): Promise<DashboardListing> {
    const response = await this.request<{ listing: ApiListingRecord }>(
      `/api/listings/${encodeURIComponent(id)}/location`,
      {
        body: JSON.stringify(location),
        method: "PUT"
      }
    );
    return mapApiListing(response.listing);
  }

  async updateListingCommute(
    id: string,
    commute: CommuteSummary | null,
    checkedAt: string
  ): Promise<DashboardListing> {
    const response = await this.request<{ listing: ApiListingRecord }>(
      `/api/listings/${encodeURIComponent(id)}/commute`,
      {
        body: JSON.stringify(commute ? { ...commute, calculatedAt: checkedAt } : { calculatedAt: checkedAt }),
        method: "PUT"
      }
    );
    return mapApiListing(response.listing);
  }

  async geocodeListingLocation(id: string): Promise<GeocodeListingResult> {
    const response = await this.request<{
      status: GeocodeListingResult["status"];
      location: ListingLocation | null;
      listing: ApiListingRecord | null;
      warnings: string[];
    }>(`/api/listings/${encodeURIComponent(id)}/location/geocode`, {
      method: "POST"
    });

    return {
      location: response.location,
      listing: response.listing ? mapApiListing(response.listing) : null,
      status: response.status,
      warnings: response.warnings
    };
  }

  async calculateListingCommute(id: string): Promise<CalculateCommuteResult> {
    const response = await this.request<{
      status: CalculateCommuteResult["status"];
      commute: CommuteSummary | null;
      routeDetail: CommuteRouteDetail | null;
      listing: ApiListingRecord | null;
      warnings: string[];
      externalDirectionsUrl: string | null;
    }>(`/api/listings/${encodeURIComponent(id)}/commute/calculate`, {
      method: "POST"
    });

    return {
      commute: response.commute,
      externalDirectionsUrl: response.externalDirectionsUrl,
      listing: response.listing ? mapApiListing(response.listing) : null,
      routeDetail: response.routeDetail ?? null,
      status: response.status,
      warnings: response.warnings
    };
  }

  async prepareListingCommute(id: string): Promise<PrepareCommuteResult> {
    const response = await this.request<{
      status: PrepareCommuteResult["status"];
      location: ListingLocation | null;
      commute: CommuteSummary | null;
      routeDetail: CommuteRouteDetail | null;
      listing: ApiListingRecord | null;
      warnings: string[];
      nextStep: PrepareCommuteResult["nextStep"];
      externalDirectionsUrl?: string | null;
    }>(`/api/listings/${encodeURIComponent(id)}/commute/prepare`, {
      method: "POST"
    });

    return {
      commute: response.commute,
      externalDirectionsUrl: response.externalDirectionsUrl ?? null,
      listing: response.listing ? mapApiListing(response.listing) : null,
      location: response.location,
      nextStep: response.nextStep,
      routeDetail: response.routeDetail ?? null,
      status: response.status,
      warnings: response.warnings
    };
  }

  async getListingCaptures(id: string): Promise<CaptureReview[]> {
    const response = await this.request<{ captures: CaptureReview[] }>(
      `/api/listings/${encodeURIComponent(id)}/captures`
    );
    return response.captures;
  }

  async deleteListing(id: string): Promise<void> {
    await this.request<void>(`/api/listings/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  }

  async importCapture(capture: CapturePayload): Promise<DashboardListing> {
    const response = await this.request<{ listing: ApiListingRecord }>("/api/captures", {
      body: JSON.stringify(capture),
      method: "POST"
    });
    return mapApiListing(response.listing);
  }

  async recalculateListingScore(id: string): Promise<DashboardListing> {
    const response = await this.request<{ listing: ApiListingRecord }>(
      `/api/listings/${encodeURIComponent(id)}/recalculate-score`,
      {
        method: "POST"
      }
    );
    return mapApiListing(response.listing);
  }

  async recalculateScores(): Promise<RecalculateScoresResult> {
    const response = await this.request<{ listings: ApiListingRecord[]; recalculatedCount: number }>("/api/scores/recalculate", {
      method: "POST"
    });

    return {
      listings: response.listings.map(mapApiListing),
      updatedCount: response.recalculatedCount
    };
  }

  async pruneDeadLinks(): Promise<PruneDeadLinksResult> {
    const response = await this.request<Omit<PruneDeadLinksResult, "listings"> & { listings: ApiListingRecord[] }>(
      "/api/listings/prune-dead-links",
      {
        method: "POST"
      }
    );

    return {
      ...response,
      listings: response.listings.map(mapApiListing)
    };
  }

  async clearListingHistory(): Promise<ClearListingHistoryResult> {
    const response = await this.request<
      Omit<ClearListingHistoryResult, "listings"> & { listings: ApiListingRecord[] }
    >("/api/listings/clear-history", {
      method: "POST"
    });

    return {
      deletedCount: response.deletedCount,
      listings: response.listings.map(mapApiListing),
      settings: response.settings
    };
  }

  async exportListingsCsv(): Promise<ListingsCsvExport> {
    const body = await this.request<string>("/api/exports/listings.csv", {
      accept: "text/csv"
    });

    return {
      body,
      contentType: "text/csv"
    };
  }

  async exportBackupJson(): Promise<ListingsJsonExport> {
    const response = await this.request<{
      settings: DashboardSettings;
      listings: ApiListingRecord[];
      captures: CapturePayload[];
    }>("/api/exports/backup.json");

    return {
      captures: response.captures,
      listings: response.listings.map(mapApiListing),
      settings: response.settings
    };
  }

  async getDashboardSnapshot(): Promise<DashboardSnapshot> {
    const [settings, listings] = await Promise.all([this.getSettings(), this.listListings()]);

    return { listings, settings };
  }

  private async request<T>(
    path: string,
    options: RequestInit & { accept?: string } = {}
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Accept", options.accept ?? "application/json");

    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (this.token) {
      headers.set("X-PAMILA-Token", this.token);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new Error(`PAMILA API request failed: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (options.accept === "text/csv") {
      return (await response.text()) as T;
    }

    return (await response.json()) as T;
  }
}

const defaultToken =
  import.meta.env.VITE_PAMILA_LOCAL_TOKEN === undefined || import.meta.env.VITE_PAMILA_LOCAL_TOKEN === ""
    ? "dev-local-token"
    : import.meta.env.VITE_PAMILA_LOCAL_TOKEN;

export const defaultApiClient = new PamilaApiClient({
  baseUrl:
    import.meta.env.VITE_PAMILA_API_BASE_URL === undefined || import.meta.env.VITE_PAMILA_API_BASE_URL === ""
      ? undefined
      : import.meta.env.VITE_PAMILA_API_BASE_URL,
  token: defaultToken
});

function toCreateListingBody(draft: ManualListingDraft) {
  const monthlyRent = parseOptionalNumber(draft.monthlyRent);
  const bedroomCount = parseOptionalNumber(draft.bedroomCount);

  return {
    availabilitySummary: blankToUndefined(draft.availabilitySummary),
    bedroomCount,
    bedroomLabel: blankToUndefined(draft.bedroomLabel),
    monthlyRent,
    source: draft.source,
    sourceUrl: draft.sourceUrl,
    stayType: draft.stayType,
    title: blankToUndefined(draft.title),
    userNotes: blankToUndefined(draft.userNotes)
  };
}

function toUpdateListingBody(patch: ListingUpdateRequest) {
  const body: Record<string, unknown> = { ...patch };

  delete body.dateWindow;
  delete body.score;
  delete body.location;
  delete body.commute;
  delete body.captureReview;
  delete body.locationSourceLabel;
  delete body.lastCommuteCheckedAt;
  delete body.routeDetail;

  if (patch.dateWindow) {
    body.availabilitySummary = patch.dateWindow.availabilitySummary;
    body.earliestMoveIn = patch.dateWindow.earliestMoveIn;
    body.latestMoveIn = patch.dateWindow.latestMoveIn;
    body.earliestMoveOut = patch.dateWindow.earliestMoveOut;
    body.latestMoveOut = patch.dateWindow.latestMoveOut;
    body.monthToMonth = patch.dateWindow.monthToMonth;
  }

  return body;
}

function mapApiListing(listing: ApiListingRecord): DashboardListing {
  const dateWindow: ListingDateWindow = {
    availabilitySummary: listing.availabilitySummary,
    earliestMoveIn: listing.earliestMoveIn,
    earliestMoveOut: listing.earliestMoveOut,
    latestMoveIn: listing.latestMoveIn,
    latestMoveOut: listing.latestMoveOut,
    monthToMonth: listing.monthToMonth
  };

  return {
    bathroomType: listing.bathroomType,
    bedroomCount: listing.bedroomCount,
    bedroomLabel: listing.bedroomLabel,
    captureReview: listing.captureReview ?? null,
    commute: listing.commute ?? listing.commuteEstimate ?? (null satisfies CommuteSummary | null),
    createdAt: listing.createdAt,
    dateWindow,
    furnished: listing.furnished,
    id: listing.id,
    kitchen: listing.kitchen,
    lastCommuteCheckedAt: listing.lastCommuteCheckedAt ?? null,
    location: listing.location ?? (null satisfies ListingLocation | null),
    locationSourceLabel: listing.locationSourceLabel ?? null,
    monthlyRent: listing.monthlyRent,
    nextAction: listing.nextAction ?? "Review listing details and cleanup actions.",
    routeDetail:
      listing.routeDetail ??
      listing.commute?.routeDetail ??
      listing.commuteEstimate?.routeDetail ??
      null,
    score: listing.scoreBreakdown ?? pendingApiScore(),
    source: listing.source,
    sourceUrl: listing.sourceUrl,
    status: listing.status,
    stayType: listing.stayType,
    title: listing.title,
    updatedAt: listing.updatedAt,
    userNotes: listing.userNotes ?? "",
    washer: listing.washer
  };
}

function pendingApiScore(): ScoreBreakdown {
  return {
    amenityScore: 0,
    cleanupActions: [
      {
        code: "score_missing",
        field: "score",
        label: "Recalculate score through the API."
      }
    ],
    commuteScore: 0,
    dateScore: 0,
    hardFilterReasons: ["Score has not been calculated yet."],
    hardFilterStatus: "needs_cleanup",
    locationScore: 0,
    priceScore: 0,
    riskFlags: [],
    scoreExplanation: "Score has not been calculated yet.",
    stayBedroomScore: 0,
    totalScore: 0
  };
}

function parseOptionalNumber(value: string): number | undefined {
  const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

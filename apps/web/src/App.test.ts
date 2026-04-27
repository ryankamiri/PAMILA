import { describe, expect, it } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { APP_NAME } from "./appConfig";
import {
  App,
  ClearListingHistoryDialog,
  ClearListingHistoryModal,
  CommuteRoutePanel,
  MapCommuteView,
  OnboardingTour,
  onboardingSteps
} from "./App";
import { PamilaApiClient } from "./apiClient";
import {
  applyCaptureSuggestionToListing,
  commuteDraftToSummary,
  createLocalBackupExport,
  createLocalCsvExport,
  createManualListing,
  getDailyQueue,
  getMissingFinalistBlockers,
  getShortlist,
  listingToCommuteDraft,
  locationDraftToLocation,
  matchesFilters
} from "./dashboardUtils";
import { emptyManualListingDraft, initialDashboardSnapshot, mockDashboardListings } from "./mockData";

describe("web dashboard lane", () => {
  it("uses the PAMILA app name", () => {
    expect(APP_NAME).toBe("PAMILA");
  });

  it("keeps fallback-only private rooms hidden unless fallback mode is enabled", () => {
    const fallbackListing = mockDashboardListings.find(
      (listing) => listing.score.hardFilterStatus === "fallback_only"
    );

    expect(fallbackListing).toBeDefined();
    expect(
      matchesFilters(fallbackListing!, {
        hardFilterStatus: "all",
        includeFallback: false,
        maxRent: 3600,
        source: "all",
        status: "all",
        text: ""
      })
    ).toBe(false);
    expect(
      matchesFilters(fallbackListing!, {
        hardFilterStatus: "all",
        includeFallback: true,
        maxRent: 3600,
        source: "all",
        status: "all",
        text: ""
      })
    ).toBe(true);
  });

  it("prioritizes cleanup items in the daily queue", () => {
    const queue = getDailyQueue(mockDashboardListings);

    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0]?.score.cleanupActions.length).toBeGreaterThanOrEqual(
      queue.at(-1)?.score.cleanupActions.length ?? 0
    );
    expect(queue.some((listing) => listing.score.hardFilterStatus === "excluded")).toBe(false);
  });

  it("shortlist contains included candidates only", () => {
    const shortlist = getShortlist(mockDashboardListings);

    expect(shortlist.length).toBeGreaterThan(0);
    expect(shortlist.every((listing) => listing.score.hardFilterStatus === "included")).toBe(true);
  });

  it("creates manual listings as cleanup-first records without scoring in the UI", () => {
    const listing = createManualListing(
      {
        ...emptyManualListingDraft,
        monthlyRent: "$3,200",
        neighborhood: "Chelsea",
        sourceUrl: "https://www.leasebreak.com/example",
        title: "Manual Chelsea test"
      },
      mockDashboardListings.length
    );

    expect(listing.title).toBe("Manual Chelsea test");
    expect(listing.monthlyRent).toBe(3200);
    expect(listing.status).toBe("needs_cleanup");
    expect(listing.score.hardFilterStatus).toBe("needs_cleanup");
    expect(listing.score.scoreExplanation).toContain("backend scoring");
  });

  it("sends API requests with the local token header", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push([input, init]);

      return {
        json: async () => ({ listings: [] }),
        ok: true,
        status: 200,
        statusText: "OK"
      } as Response;
    }) as typeof fetch;
    const client = new PamilaApiClient({
      baseUrl: "http://localhost:7410",
      fetchImpl: fetchMock,
      token: "local-token"
    });

    await client.listListings();

    const [, options] = calls[0]!;
    const headers = (options as RequestInit).headers as Headers;
    expect(headers.get("X-PAMILA-Token")).toBe("local-token");
    expect(calls[0]?.[0]).toBe("http://localhost:7410/api/listings");
  });

  it("renders the manual MVP controls on the dashboard shell", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain("Export CSV");
    expect(markup).toContain("Backup");
    expect(markup).toContain("How PAMILA Works");
    expect(markup).toContain("Clean dead links");
    expect(markup).toContain("Clear listing history");
    expect(markup).toContain("Map/Commute");
    expect(markup).toContain("Manual Add");
  });

  it("renders clear listing history behind a visible confirmation modal", () => {
    const closedMarkup = renderToStaticMarkup(
      createElement(ClearListingHistoryModal, {
        isOpen: false,
        listingCount: 3,
        onCancel: () => undefined,
        onConfirm: () => undefined
      })
    );
    const openMarkup = renderToStaticMarkup(
      createElement(ClearListingHistoryModal, {
        isOpen: true,
        listingCount: 3,
        onCancel: () => undefined,
        onConfirm: () => undefined
      })
    );

    expect(closedMarkup).toBe("");
    expect(openMarkup).toContain("role=\"dialog\"");
    expect(openMarkup).toContain("Clear listing history?");
    expect(openMarkup).toContain("This deletes 3 saved listings");
    expect(openMarkup).toContain("Cancel");
    expect(openMarkup).toContain("Clear listing history");
  });

  it("does not clear listing history until the destructive modal confirmation is invoked", () => {
    let cancelCount = 0;
    let confirmCount = 0;
    const tree = ClearListingHistoryDialog({
      listingCount: 2,
      onCancel: () => {
        cancelCount += 1;
      },
      onConfirm: () => {
        confirmCount += 1;
      }
    });

    expect(cancelCount).toBe(0);
    expect(confirmCount).toBe(0);

    const cancelButton = findButtonByText(tree, "Cancel");
    const confirmButton = findButtonByText(tree, "Clear listing history");

    cancelButton.props.onClick();
    expect(cancelCount).toBe(1);
    expect(confirmCount).toBe(0);

    confirmButton.props.onClick();
    expect(confirmCount).toBe(1);
  });

  it("renders the onboarding tour with workflow and troubleshooting copy", () => {
    const markup = renderToStaticMarkup(
      createElement(OnboardingTour, {
        isOpen: true,
        onBack: () => undefined,
        onDismiss: () => undefined,
        onFinish: () => undefined,
        onNext: () => undefined,
        onSkip: () => undefined,
        stepIndex: 1,
        steps: onboardingSteps
      })
    );

    expect(markup).toContain("API Status");
    expect(markup).toContain("Connected to local API");
    expect(markup).toContain("Mock data means");
    expect(markup).toContain("Back");
    expect(markup).toContain("Next");
    expect(markup).toContain("Skip");
  });

  it("defines onboarding steps for the workflow views", () => {
    expect(onboardingSteps.map((step) => step.id)).toEqual([
      "welcome",
      "api-status",
      "daily-queue",
      "inbox-manual-add",
      "listing-detail",
      "map-commute",
      "shortlist-panic",
      "settings-exports",
      "daily-use-loop"
    ]);
    expect(onboardingSteps.find((step) => step.id === "inbox-manual-add")?.targetView).toBe("inbox");
    expect(onboardingSteps.find((step) => step.id === "map-commute")?.targetView).toBe("commute");
    expect(onboardingSteps.find((step) => step.id === "settings-exports")?.targetView).toBe("settings");
  });

  it("renders the OSM map shell with Ramp and coordinate queues", () => {
    const markup = renderToStaticMarkup(
      createElement(MapCommuteView, {
        listings: mockDashboardListings,
        onCalculateCommute: () => undefined,
        onGeocodeLocation: () => undefined,
        onSelect: () => undefined,
        settings: initialDashboardSnapshot.settings
      })
    );

    expect(markup).toContain("data-testid=\"pamila-osm-map\"");
    expect(markup).toContain("OpenStreetMap");
    expect(markup).toContain("Need coords");
    expect(markup).toContain("Geocode");
    expect(markup).toContain("Geocode then calculate route");
    expect(markup).toContain("Route readiness checklist");
  });

  it("renders route readiness labels for missing, geocodable, coordinate, and saved-route states", () => {
    const base = mockDashboardListings[0]!;
    const noLocation = {
      ...base,
      id: "route-no-location",
      location: null,
      routeDetail: null
    } satisfies typeof base;
    const withCoordinates = {
      ...base,
      id: "route-with-coordinates",
      location: {
        ...base.location!,
        lat: 40.7465,
        lng: -74.0014
      },
      routeDetail: null
    } satisfies typeof base;

    const noLocationMarkup = renderToStaticMarkup(
      createElement(CommuteRoutePanel, {
        listing: noLocation,
        onCalculateCommute: () => undefined
      })
    );
    const needsCoordinatesMarkup = renderToStaticMarkup(
      createElement(CommuteRoutePanel, {
        listing: base,
        onCalculateCommute: () => undefined
      })
    );
    const coordinateMarkup = renderToStaticMarkup(
      createElement(CommuteRoutePanel, {
        listing: withCoordinates,
        onCalculateCommute: () => undefined
      })
    );

    expect(noLocationMarkup).toContain("Add or accept approximate location first");
    expect(needsCoordinatesMarkup).toContain("Geocode then calculate route");
    expect(coordinateMarkup).toContain("Calculate route with OTP");
    expect(coordinateMarkup).toContain("OTP server status");
    expect(coordinateMarkup).toContain("Will try automatically");

    const otpUnavailableMarkup = renderToStaticMarkup(
      createElement(CommuteRoutePanel, {
        listing: withCoordinates,
        onCalculateCommute: () => undefined,
        routePreparation: {
          attemptedAt: "2026-04-16T12:00:00.000Z",
          automatic: true,
          externalDirectionsUrl: "https://maps.example/transit",
          nextStep: "manual_commute",
          status: "otp_unavailable",
          warnings: ["OTP is not running; manual commute still works."]
        }
      })
    );

    expect(otpUnavailableMarkup).toContain("OTP not running");
    expect(otpUnavailableMarkup).toContain("PAMILA tried automatically.");
    expect(otpUnavailableMarkup).toContain("Manual commute can still rank this listing");
    expect(otpUnavailableMarkup).toContain("Open transit directions fallback");

    const noGeocodeResultMarkup = renderToStaticMarkup(
      createElement(CommuteRoutePanel, {
        listing: base,
        onCalculateCommute: () => undefined,
        routePreparation: {
          attemptedAt: "2026-04-16T12:00:00.000Z",
          automatic: false,
          externalDirectionsUrl: null,
          nextStep: "enter_coordinates",
          status: "no_result",
          warnings: ["Could not find coordinates for this location; enter lat/lng manually."]
        }
      })
    );

    expect(noGeocodeResultMarkup).toContain("No geocode result");
    expect(noGeocodeResultMarkup).toContain("Geocoding did not find coordinates");

    const preparedButRefreshPendingMarkup = renderToStaticMarkup(
      createElement(CommuteRoutePanel, {
        listing: withCoordinates,
        onCalculateCommute: () => undefined,
        routePreparation: {
          attemptedAt: "2026-04-16T12:00:00.000Z",
          automatic: true,
          externalDirectionsUrl: null,
          nextStep: "review_route",
          status: "ok",
          warnings: []
        }
      })
    );

    expect(preparedButRefreshPendingMarkup).toContain("Saved by latest preparation");
    expect(preparedButRefreshPendingMarkup).not.toContain("Not saved");
  });

  it("renders saved route details as leg-by-leg commute steps", () => {
    const listing = {
      ...mockDashboardListings[0]!,
      routeDetail: {
        calculatedAt: "2026-04-16T12:00:00.000Z",
        destinationLabel: "Ramp NYC",
        externalDirectionsUrl: "https://www.google.com/maps/dir/?api=1",
        legs: [
          {
            color: "#6b7280",
            dashArray: "6 6",
            distanceMeters: 450,
            durationMinutes: 5,
            fromName: "Chelsea",
            geometry: [
              [40.7465, -74.0014],
              [40.7421, -73.9916]
            ],
            lineName: null,
            mode: "WALK",
            routeLongName: null,
            style: "walk",
            toName: "23 St"
          },
          {
            color: "#2563eb",
            dashArray: null,
            distanceMeters: 1600,
            durationMinutes: 13,
            fromName: "23 St",
            geometry: [
              [40.7421, -73.9916],
              [40.74205, -73.99154]
            ],
            lineName: "N",
            mode: "SUBWAY",
            routeLongName: "N route",
            style: "rail",
            toName: "Ramp NYC"
          }
        ],
        originLabel: "Chelsea"
      }
    } satisfies typeof mockDashboardListings[number];
    const markup = renderToStaticMarkup(
      createElement(CommuteRoutePanel, {
        listing,
        onCalculateCommute: () => undefined
      })
    );

    expect(markup).toContain("Route to Ramp");
    expect(markup).toContain("Subway N");
    expect(markup).toContain("23 St to Ramp NYC");
    expect(markup).toContain("Recalculate route");
    expect(markup).toContain("Saved route detail");
  });

  it("flattens listing updates for the existing PATCH endpoint", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push([input, init]);

      return {
        json: async () => ({
          listing: {
            availabilitySummary: "Available Jun 30 to Sep 12",
            bathroomType: "unknown",
            bedroomCount: 0,
            bedroomLabel: "Studio",
            createdAt: "2026-04-16T00:00:00.000Z",
            earliestMoveIn: null,
            earliestMoveOut: null,
            furnished: "unknown",
            id: "listing-test",
            kitchen: "unknown",
            latestMoveIn: null,
            latestMoveOut: null,
            monthToMonth: false,
            monthlyRent: 3200,
            nextAction: null,
            scoreBreakdown: null,
            source: "leasebreak",
            sourceUrl: "https://www.leasebreak.com/test",
            status: "contacted",
            stayType: "entire_apartment",
            title: "Test listing",
            updatedAt: "2026-04-16T00:00:00.000Z",
            userNotes: "Messaged landlord",
            washer: "unknown"
          }
        }),
        ok: true,
        status: 200,
        statusText: "OK"
      } as Response;
    }) as typeof fetch;
    const client = new PamilaApiClient({
      baseUrl: "http://localhost:7410",
      fetchImpl: fetchMock,
      token: "local-token"
    });

    await client.updateListing("listing-test", {
      dateWindow: {
        availabilitySummary: "Available Jun 30 to Sep 12"
      },
      status: "contacted",
      userNotes: "Messaged landlord"
    });

    const [, options] = calls[0]!;
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      availabilitySummary: "Available Jun 30 to Sep 12",
      status: "contacted",
      userNotes: "Messaged landlord"
    });
    expect(body.dateWindow).toBeUndefined();
  });

  it("sends manual location and commute updates to the API contract routes", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const apiListing = {
      availabilitySummary: null,
      bathroomType: "unknown",
      bedroomCount: 0,
      bedroomLabel: "Studio",
      createdAt: "2026-04-16T00:00:00.000Z",
      earliestMoveIn: null,
      earliestMoveOut: null,
      furnished: "unknown",
      id: "listing-test",
      kitchen: "unknown",
      latestMoveIn: null,
      latestMoveOut: null,
      monthToMonth: false,
      monthlyRent: 3200,
      nextAction: null,
      scoreBreakdown: null,
      source: "leasebreak",
      sourceUrl: "https://www.leasebreak.com/test",
      status: "needs_cleanup",
      stayType: "entire_apartment",
      title: "Test listing",
      updatedAt: "2026-04-16T00:00:00.000Z",
      userNotes: null,
      washer: "unknown"
    };
    const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push([input, init]);

      return {
        json: async () => ({ listing: apiListing }),
        ok: true,
        status: 200,
        statusText: "OK"
      } as Response;
    }) as typeof fetch;
    const client = new PamilaApiClient({
      baseUrl: "http://localhost:7410",
      fetchImpl: fetchMock,
      token: "local-token"
    });
    const location = locationDraftToLocation({
      address: "",
      confidenceLabel: "neighborhood",
      crossStreets: "",
      lat: "",
      lng: "",
      neighborhood: "Chelsea",
      sourceLabel: "user_confirmed"
    });
    const commute = commuteDraftToSummary({
      hasBusHeavyRoute: false,
      lastCheckedAt: "",
      lineNames: "F, M",
      routeSummary: "F/M to 23 St",
      totalMinutes: "18",
      transferCount: "0",
      walkMinutes: "5"
    });

    await client.updateListingLocation("listing-test", location);
    await client.updateListingCommute("listing-test", commute, "2026-04-16T12:00:00.000Z");

    expect(calls[0]?.[0]).toBe("http://localhost:7410/api/listings/listing-test/location");
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({
      label: "Chelsea",
      neighborhood: "Chelsea"
    });
    expect(calls[1]?.[0]).toBe("http://localhost:7410/api/listings/listing-test/commute");
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({
      calculatedAt: "2026-04-16T12:00:00.000Z",
      lineNames: ["F", "M"],
      totalMinutes: 18
    });
  });

  it("calls geocode, OTP calculate, and route prepare API routes", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const apiListing = {
      availabilitySummary: null,
      bathroomType: "unknown",
      bedroomCount: 0,
      bedroomLabel: "Studio",
      createdAt: "2026-04-16T00:00:00.000Z",
      earliestMoveIn: null,
      earliestMoveOut: null,
      furnished: "unknown",
      id: "listing-test",
      kitchen: "unknown",
      latestMoveIn: null,
      latestMoveOut: null,
      monthToMonth: false,
      monthlyRent: 3200,
      nextAction: null,
      scoreBreakdown: null,
      source: "leasebreak",
      sourceUrl: "https://www.leasebreak.com/test",
      status: "needs_cleanup",
      stayType: "entire_apartment",
      title: "Test listing",
      updatedAt: "2026-04-16T00:00:00.000Z",
      userNotes: null,
      washer: "unknown"
    };
    const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push([input, init]);

      return {
        json: async () => ({
          commute: null,
          externalDirectionsUrl: null,
          listing: apiListing,
          location: null,
          status: "ok",
          warnings: []
        }),
        ok: true,
        status: 200,
        statusText: "OK"
      } as Response;
    }) as typeof fetch;
    const client = new PamilaApiClient({
      baseUrl: "http://localhost:7410",
      fetchImpl: fetchMock,
      token: "local-token"
    });

    await client.geocodeListingLocation("listing-test");
    await client.calculateListingCommute("listing-test");
    await client.prepareListingCommute("listing-test");

    expect(calls[0]?.[0]).toBe("http://localhost:7410/api/listings/listing-test/location/geocode");
    expect(calls[0]?.[1]?.method).toBe("POST");
    expect(calls[1]?.[0]).toBe("http://localhost:7410/api/listings/listing-test/commute/calculate");
    expect(calls[1]?.[1]?.method).toBe("POST");
    expect(calls[2]?.[0]).toBe("http://localhost:7410/api/listings/listing-test/commute/prepare");
    expect(calls[2]?.[1]?.method).toBe("POST");
  });

  it("calls the dead-link cleanup API route and maps refreshed listings", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const apiListing = {
      availabilitySummary: null,
      bathroomType: "unknown",
      bedroomCount: 0,
      bedroomLabel: "Studio",
      createdAt: "2026-04-16T00:00:00.000Z",
      earliestMoveIn: null,
      earliestMoveOut: null,
      furnished: "unknown",
      id: "listing-kept",
      kitchen: "unknown",
      latestMoveIn: null,
      latestMoveOut: null,
      monthToMonth: false,
      monthlyRent: 3200,
      nextAction: null,
      scoreBreakdown: null,
      source: "airbnb",
      sourceUrl: "https://www.airbnb.com/rooms/kept",
      status: "needs_cleanup",
      stayType: "entire_apartment",
      title: "Kept listing",
      updatedAt: "2026-04-16T00:00:00.000Z",
      userNotes: null,
      washer: "unknown"
    };
    const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push([input, init]);

      return {
        json: async () => ({
          checkedCount: 2,
          kept: [],
          listings: [apiListing],
          removed: [
            {
              id: "listing-dead",
              reason: "source_returned_404",
              source: "leasebreak",
              sourceUrl: "https://www.leasebreak.com/dead",
              status: 404,
              title: "Dead listing"
            }
          ],
          removedCount: 1,
          warnings: []
        }),
        ok: true,
        status: 200,
        statusText: "OK"
      } as Response;
    }) as typeof fetch;
    const client = new PamilaApiClient({
      baseUrl: "http://localhost:7410",
      fetchImpl: fetchMock,
      token: "local-token"
    });

    const result = await client.pruneDeadLinks();

    expect(calls[0]?.[0]).toBe("http://localhost:7410/api/listings/prune-dead-links");
    expect(calls[0]?.[1]?.method).toBe("POST");
    expect(result.removedCount).toBe(1);
    expect(result.listings[0]?.id).toBe("listing-kept");
  });

  it("calls the clear listing history API route and maps the refreshed empty snapshot", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push([input, init]);

      return {
        json: async () => ({
          deletedCount: 2,
          listings: [],
          settings: {
            ...initialDashboardSnapshot.settings,
            maxMonthlyRent: 4100
          }
        }),
        ok: true,
        status: 200,
        statusText: "OK"
      } as Response;
    }) as typeof fetch;
    const client = new PamilaApiClient({
      baseUrl: "http://localhost:7410",
      fetchImpl: fetchMock,
      token: "local-token"
    });

    const result = await client.clearListingHistory();

    expect(calls[0]?.[0]).toBe("http://localhost:7410/api/listings/clear-history");
    expect(calls[0]?.[1]?.method).toBe("POST");
    expect(result.deletedCount).toBe(2);
    expect(result.listings).toEqual([]);
    expect(result.settings.maxMonthlyRent).toBe(4100);
  });

  it("sends settings updates including Panic Mode and AI capture toggles", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push([input, init]);

      return {
        json: async () => ({
          settings: {
            ...initialDashboardSnapshot.settings,
            aiOnCaptureEnabled: true,
            panicModeEnabled: true
          }
        }),
        ok: true,
        status: 200,
        statusText: "OK"
      } as Response;
    }) as typeof fetch;
    const client = new PamilaApiClient({
      baseUrl: "http://localhost:7410",
      fetchImpl: fetchMock,
      token: "local-token"
    });

    await client.updateSettings({
      ...initialDashboardSnapshot.settings,
      aiOnCaptureEnabled: true,
      panicModeEnabled: true
    });

    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body.aiOnCaptureEnabled).toBe(true);
    expect(body.panicModeEnabled).toBe(true);
  });

  it("builds manual location and commute values without scoring in React", () => {
    const location = locationDraftToLocation({
      address: "",
      confidenceLabel: "cross_street",
      crossStreets: "W 23rd St and 6th Ave",
      lat: "40.7421",
      lng: "-73.9916",
      neighborhood: "Flatiron",
      sourceLabel: "user_confirmed"
    });
    const commute = commuteDraftToSummary({
      hasBusHeavyRoute: false,
      lastCheckedAt: "2026-04-16T12:00:00.000Z",
      lineNames: "N, R, W",
      routeSummary: "N/R/W to 23 St",
      totalMinutes: "18",
      transferCount: "0",
      walkMinutes: "5"
    });

    expect(location?.source).toBe("cross_streets");
    expect(location?.confidence).toBe("high");
    expect(location?.lat).toBe(40.7421);
    expect(location?.lng).toBe(-73.9916);
    expect(commute?.confidence).toBe("manual");
    expect(commute?.lineNames).toEqual(["N", "R", "W"]);
  });

  it("surfaces missing finalist blockers for cleanup", () => {
    const listing = createManualListing(emptyManualListingDraft, 0);

    expect(getMissingFinalistBlockers(listing)).toEqual([
      "price",
      "dates",
      "location"
    ]);
  });

  it("applies capture suggestions to local listing state", () => {
    const listing = mockDashboardListings[1]!;
    const suggestion = listing.captureReview?.suggestions.find(
      (candidate) => candidate.field === "location"
    );

    expect(suggestion).toBeDefined();

    const updated = applyCaptureSuggestionToListing(listing, suggestion!);

    expect(updated.location?.neighborhood).toBe("Long Island City");
    expect(updated.locationSourceLabel).toBe("airbnb_approximate");
  });

  it("creates local CSV and JSON exports for API-offline fallback", () => {
    const csv = createLocalCsvExport(mockDashboardListings.slice(0, 1));
    const backup = createLocalBackupExport(initialDashboardSnapshot);

    expect(csv).toContain("sourceUrl");
    expect(csv).toContain("Bright Chelsea studio");
    expect(JSON.parse(backup).settings.maxMonthlyRent).toBe(3600);
  });

  it("hydrates commute editor drafts from listings", () => {
    const draft = listingToCommuteDraft(mockDashboardListings[0]!);

    expect(draft.totalMinutes).toBe("18");
    expect(draft.lineNames).toContain("N");
  });
});

function findButtonByText(node: ReactNode, text: string): { props: { onClick: () => void } } {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findButtonByTextOrNull(child, text);
      if (result) {
        return result;
      }
    }
  }

  const result = findButtonByTextOrNull(node, text);
  if (!result) {
    throw new Error(`Button not found: ${text}`);
  }

  return result;
}

function findButtonByTextOrNull(
  node: ReactNode,
  text: string
): { props: { onClick: () => void } } | null {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }

  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findButtonByTextOrNull(child, text);
      if (result) {
        return result;
      }
    }
    return null;
  }

  if (!isValidElement(node)) {
    return null;
  }

  const props = node.props as {
    children?: ReactNode;
    onClick?: () => void;
  };
  if (node.type === "button" && props.onClick && nodeText(props.children).includes(text)) {
    return { props: { onClick: props.onClick } };
  }

  return findButtonByTextOrNull(props.children, text);
}

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }

  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(nodeText).join(" ");
  }

  if (!isValidElement(node)) {
    return "";
  }

  return nodeText((node.props as { children?: ReactNode }).children);
}

import { describe, expect, it } from "vitest";

import { APP_NAME } from "./appConfig";
import { PamilaApiClient } from "./apiClient";
import { createManualListing, getDailyQueue, getShortlist, matchesFilters } from "./dashboardUtils";
import { emptyManualListingDraft, mockDashboardListings } from "./mockData";

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
});

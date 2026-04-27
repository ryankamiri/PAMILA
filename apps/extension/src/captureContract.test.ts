import { afterEach, describe, expect, it, vi } from "vitest";

import { checkApiConnection, lookupSavedListings } from "./apiClient";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_DISPLAY_NAME,
  HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE,
  HELPER_CHECK_CONNECTION_MESSAGE_TYPE,
  HELPER_LOOKUP_LISTINGS_MESSAGE_TYPE
} from "./captureContract";
import { decideLeasebreakAutoSave } from "./leasebreakAutoSave";
import {
  detectListingSource,
  extractApproxAirbnbLocationFromText,
  extractVisibleFieldsFromText,
  normalizeThumbnailCandidates,
  truncateText
} from "./extraction";
import { buildHelperViewModel } from "./helperLogic";
import { classifyExtensionPage } from "./pageClassifier";
import {
  buildSavedListingMatchesByUrl,
  canonicalizeExtensionListingUrl,
  mergeApiMatchesIntoSavedListingsCache,
  removeLookupMissesFromSavedListingsCache
} from "./savedListings";
import { normalizeExtensionSettings } from "./settings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extension scaffold", () => {
  it("names the capture helper", () => {
    expect(EXTENSION_DISPLAY_NAME).toBe("PAMILA Capture");
  });

  it("defines helper background message types", () => {
    expect(HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE).toBe("PAMILA_HELPER_CAPTURE_ACTIVE_TAB");
    expect(HELPER_CHECK_CONNECTION_MESSAGE_TYPE).toBe("PAMILA_HELPER_CHECK_CONNECTION");
    expect(HELPER_LOOKUP_LISTINGS_MESSAGE_TYPE).toBe("PAMILA_HELPER_LOOKUP_LISTINGS");
  });
});

describe("source detection", () => {
  it("detects Airbnb and Leasebreak pages", () => {
    expect(detectListingSource("https://www.airbnb.com/rooms/12345")).toBe("airbnb");
    expect(detectListingSource("https://www.leasebreak.com/short-term-rental-details/abc")).toBe("leasebreak");
  });

  it("rejects unsupported pages", () => {
    expect(detectListingSource("https://example.com/rooms/12345")).toBeNull();
    expect(detectListingSource("not a url")).toBeNull();
  });
});

describe("page classification", () => {
  it("distinguishes Airbnb search and listing pages", () => {
    expect(classifyExtensionPage("https://airbnb.com/")).toEqual({
      source: "airbnb",
      status: "search_page"
    });
    expect(classifyExtensionPage("https://www.airbnb.com/s/New-York--NY/homes")).toEqual({
      source: "airbnb",
      status: "search_page"
    });
    expect(classifyExtensionPage("https://www.airbnb.com/rooms/12345?adults=1")).toEqual({
      source: "airbnb",
      status: "listing_page"
    });
  });

  it("distinguishes Leasebreak listing and unsupported pages", () => {
    expect(classifyExtensionPage("https://www.leasebreak.com/short-term-rental-details/chelsea-studio")).toEqual({
      source: "leasebreak",
      status: "listing_page"
    });
    expect(classifyExtensionPage("https://www.leasebreak.com/")).toEqual({
      source: "leasebreak",
      status: "search_page"
    });
    expect(classifyExtensionPage("https://www.leasebreak.com/search?housing_type=studio")).toEqual({
      source: "leasebreak",
      status: "search_page"
    });
    expect(classifyExtensionPage("https://example.com/rooms/12345")).toEqual({
      source: null,
      status: "unsupported_page"
    });
  });
});

describe("floating helper guidance", () => {
  it("shows save guidance for listing pages", () => {
    const model = buildHelperViewModel(
      {
        source: "airbnb",
        status: "listing_page"
      },
      "connected"
    );

    expect(model.pageStatusLabel).toBe("Listing page");
    expect(model.apiStatusLabel).toBe("Connected");
    expect(model.canSaveListing).toBe(true);
    expect(model.primaryActionLabel).toBe("Save this listing to PAMILA");
    expect(model.quickSaveVisible).toBe(true);
    expect(model.quickSaveLabel).toBe("Save to PAMILA");
    expect(model.quickSaveAction).toBe("save");
  });

  it("blocks search-page batch capture and shows the search checklist", () => {
    const model = buildHelperViewModel(
      {
        source: "airbnb",
        status: "search_page"
      },
      "token_issue"
    );

    expect(model.pageStatusLabel).toBe("Search page");
    expect(model.apiStatusLabel).toBe("Token issue");
    expect(model.canSaveListing).toBe(false);
    expect(model.quickSaveVisible).toBe(false);
    expect(model.quickSaveLabel).toBeNull();
    expect(model.guidanceBullets.join(" ")).toContain("Open one promising listing page");
    expect(model.guidanceBullets.join(" ")).toContain("$3,600");
  });

  it("guides Leasebreak search pages to open one listing without card capture", () => {
    const model = buildHelperViewModel(
      {
        source: "leasebreak",
        status: "search_page"
      },
      "connected"
    );

    expect(model.canSaveListing).toBe(false);
    expect(model.quickSaveVisible).toBe(false);
    expect(model.guidanceBullets.join(" ")).toContain("Open one specific Leasebreak listing page");
    expect(model.guidanceBullets.join(" ")).toContain("does not batch-capture search cards");
    expect(model.guidanceBullets.join(" ")).not.toContain("$3,600");
  });

  it("labels quick-save states for saved and blocked listing pages", () => {
    const page = {
      source: "airbnb" as const,
      status: "listing_page" as const
    };

    expect(buildHelperViewModel(page, "connected", "saved")).toMatchObject({
      quickSaveAction: "disabled",
      quickSaveLabel: "Already in PAMILA",
      quickSaveVisible: true
    });

    expect(buildHelperViewModel(page, "api_offline")).toMatchObject({
      quickSaveAction: "open_helper",
      quickSaveLabel: "API offline",
      quickSaveVisible: true
    });

    expect(buildHelperViewModel(page, "token_issue")).toMatchObject({
      quickSaveAction: "open_helper",
      quickSaveLabel: "Fix token",
      quickSaveVisible: true
    });
  });
});

describe("saved listing state", () => {
  it("canonicalizes Airbnb room URLs for saved-state lookup", () => {
    expect(
      canonicalizeExtensionListingUrl(
        "https://www.airbnb.com/rooms/54183564?adults=1&check_in=2026-06-30#photos",
        "airbnb"
      )
    ).toBe("https://www.airbnb.com/rooms/54183564");
  });

  it("merges API matches into cache and maps them back to requested URLs", () => {
    const canonicalUrl = "https://www.airbnb.com/rooms/54183564";
    const cache = mergeApiMatchesIntoSavedListingsCache(
      {},
      {
        [canonicalUrl]: {
          canonicalUrl,
          listingId: "listing-1",
          sourceUrl: "https://www.airbnb.com/rooms/54183564?check_in=2026-06-30",
          status: "needs_cleanup",
          title: "Astoria one bed"
        }
      },
      "2026-04-25T12:00:00.000Z"
    );

    expect(
      buildSavedListingMatchesByUrl(
        ["https://www.airbnb.com/rooms/54183564?adults=1"],
        cache,
        "api",
        "airbnb"
      )
    ).toMatchObject({
      "https://www.airbnb.com/rooms/54183564?adults=1": {
        listingId: "listing-1",
        lookupSource: "api",
        title: "Astoria one bed"
      }
    });
  });

  it("removes cache entries for API-confirmed lookup misses", () => {
    const canonicalUrl = "https://www.airbnb.com/rooms/54183564";
    const cache = mergeApiMatchesIntoSavedListingsCache(
      {},
      {
        [canonicalUrl]: {
          canonicalUrl,
          listingId: "listing-1",
          sourceUrl: canonicalUrl,
          status: "needs_cleanup",
          title: "Astoria one bed"
        }
      },
      "2026-04-25T12:00:00.000Z"
    );

    expect(
      removeLookupMissesFromSavedListingsCache(
        cache,
        ["https://www.airbnb.com/rooms/54183564?adults=1"],
        {},
        "airbnb"
      )
    ).toEqual({});
  });

  it("canonicalizes Leasebreak details URLs for saved-state lookup", () => {
    expect(
      canonicalizeExtensionListingUrl(
        "https://www.leasebreak.com/short-term-rental-details/chelsea-studio?foo=bar#photos",
        "leasebreak"
      )
    ).toBe("https://www.leasebreak.com/short-term-rental-details/chelsea-studio");
  });
});

describe("bounded text capture", () => {
  it("normalizes and truncates captured text", () => {
    expect(truncateText("  one\n\n two   three  ", 20)).toBe("one two three");
    expect(truncateText("abcdefgh", 4)).toBe("abcd");
    expect(truncateText("   ", 10)).toBeNull();
  });
});

describe("visible field extraction", () => {
  it("extracts Airbnb-style listing hints", () => {
    const fields = extractVisibleFieldsFromText(
      "airbnb",
      "Entire rental unit in Chelsea. $3,250 month. 1 bedroom. Private bathroom. Kitchen. Washer in unit. Furnished."
    );

    expect(fields).toMatchObject({
      monthly_rent_candidate: "$3,250 month",
      bedroom_candidate: "1 bedroom",
      bathroom_candidate: "Private bathroom",
      stay_type_candidate: "entire_apartment",
      kitchen_candidate: "mentioned",
      washer_candidate: "in_unit",
      furnished_candidate: "yes"
    });
  });

  it("extracts Airbnb current monthly rent instead of the struck-through price", () => {
    const fields = extractVisibleFieldsFromText(
      "airbnb",
      "Reserve $4,030 monthly $3,518 monthly Check-in 6/30/2026 Checkout 9/12/2026"
    );

    expect(fields).toMatchObject({
      airbnb_current_monthly_rent: "$3,518 monthly",
      airbnb_original_monthly_rent: "$4,030 monthly",
      monthly_rent_candidate: "$3,518 monthly"
    });
  });

  it("extracts Airbnb bedroom count from bedroom, not bed", () => {
    const fields = extractVisibleFieldsFromText(
      "airbnb",
      "Entire rental unit in New York, United States 1 guest · 1 bedroom · 1 bed · 1 bath"
    );

    expect(fields).toMatchObject({
      airbnb_bedroom_count: "1",
      airbnb_bedroom_summary: "1 guest · 1 bedroom · 1 bed · 1 bath",
      bedroom_candidate: "1 bedroom"
    });
  });

  it("extracts Airbnb availability from selected date ranges instead of page chrome", () => {
    const fields = extractVisibleFieldsFromText(
      "airbnb",
      "Skip to content Homes Homes NEW NEW Services. 74 nights in New York Jun 30, 2026 - Sep 12, 2026 Calendar."
    );

    expect(fields).toMatchObject({
      airbnb_availability_summary: "Available Jun 30, 2026 to Sep 12, 2026"
    });
  });

  it("keeps Airbnb studio only when the primary facts actually say studio", () => {
    const fields = extractVisibleFieldsFromText(
      "airbnb",
      "Entire rental unit in New York, United States 1 guest · studio · 1 bed · 1 bath"
    );

    expect(fields).toMatchObject({
      airbnb_bedroom_count: "0",
      bedroom_candidate: "Studio"
    });
  });

  it("extracts Leasebreak date-window hints and immediate risk", () => {
    const fields = extractVisibleFieldsFromText(
      "leasebreak",
      "Studio $3,100 per month. Earliest Move-In Date: Immediate Latest Move-In Date: July 1 Earliest Move-Out Date: September 12 Latest Move-Out Date: September 30 Month to month."
    );

    expect(fields).toMatchObject({
      bedroom_candidate: "Studio",
      earliest_move_in_candidate: "Immediate",
      latest_move_in_candidate: "July 1",
      earliest_move_out_candidate: "September 12",
      latest_move_out_candidate: "September 30",
      move_in_urgency_candidate: "immediate",
      month_to_month_candidate: "yes"
    });
  });

  it("extracts Leasebreak bedrooms and listing type from detail-page basics", () => {
    const fields = extractVisibleFieldsFromText(
      "leasebreak",
      "The Basics Bedrooms: 1 Bathrooms: 1 (Private) Decor: Furnished Only $3,200/mo Earliest Move-In Immediate 3 month min The Basics Listing type: Short Term Rental Posted by: Professional Landlord Property Details This spacious apartment can be used as a convertible 2 bedroom or as a 1 bedroom with office space."
    );

    expect(fields).toMatchObject({
      bedroom_candidate: "1 bedroom",
      leasebreak_bedroom_count: "1",
      leasebreak_listing_type: "Short Term Rental",
      stay_type_candidate: "entire_apartment"
    });
  });
});

describe("approximate Airbnb location extraction", () => {
  it("extracts a visible location label", () => {
    expect(extractApproxAirbnbLocationFromText("Where you'll be Chelsea, New York, United States")).toEqual({
      label: "Chelsea",
      neighborhood: "Chelsea"
    });
  });

  it("extracts a better neighborhood when Airbnb only says New York nearby", () => {
    expect(
      extractApproxAirbnbLocationFromText(
        "Cozy Flat in the Heart of the Upper West Side. Where you'll be New York, United States"
      )
    ).toEqual({
      label: "Upper West Side",
      neighborhood: "Upper West Side"
    });
  });
});

describe("thumbnail candidates", () => {
  it("keeps only bounded unique HTTP image candidates", () => {
    expect(
      normalizeThumbnailCandidates(
        [
          { url: "https://example.com/a.jpg", width: 800, height: 600 },
          { url: "https://example.com/a.jpg", width: 800, height: 600 },
          { url: "data:image/png;base64,abc", width: null, height: null },
          { url: "https://example.com/icon.svg", width: 32, height: 32 },
          { url: "https://example.com/b.webp", width: null, height: null }
        ],
        2
      )
    ).toEqual([
      { url: "https://example.com/a.jpg", width: 800, height: 600 },
      { url: "https://example.com/b.webp", width: null, height: null }
    ]);
  });
});

describe("settings normalization", () => {
  it("uses local defaults and trims trailing API slashes", () => {
    expect(normalizeExtensionSettings({ apiBaseUrl: "http://localhost:7410///" })).toMatchObject({
      ...DEFAULT_EXTENSION_SETTINGS,
      apiBaseUrl: "http://localhost:7410"
    });
  });

  it("defaults Leasebreak auto-save off", () => {
    expect(normalizeExtensionSettings({}).autoSaveLeasebreakListings).toBe(false);
  });
});

describe("Leasebreak auto-save policy", () => {
  const leasebreakListingPage = {
    source: "leasebreak" as const,
    status: "listing_page" as const
  };
  const leasebreakUrl = "https://www.leasebreak.com/short-term-rental-details/chelsea-studio?utm=test";

  it("keeps auto-save disabled by default", () => {
    expect(
      decideLeasebreakAutoSave({
        allowAutoSaveCurrentPage: true,
        alreadyAttempted: false,
        currentTabUrl: leasebreakUrl,
        matchesByUrl: {},
        page: leasebreakListingPage,
        requestedUrls: [leasebreakUrl],
        settings: normalizeExtensionSettings({})
      })
    ).toMatchObject({
      reason: "disabled",
      shouldAutoSave: false
    });
  });

  it("allows one current Leasebreak listing lookup miss when enabled", () => {
    expect(
      decideLeasebreakAutoSave({
        allowAutoSaveCurrentPage: true,
        alreadyAttempted: false,
        currentTabUrl: leasebreakUrl,
        matchesByUrl: {},
        page: leasebreakListingPage,
        requestedUrls: [leasebreakUrl],
        settings: normalizeExtensionSettings({ autoSaveLeasebreakListings: true })
      })
    ).toEqual({
      canonicalUrl: "https://www.leasebreak.com/short-term-rental-details/chelsea-studio",
      reason: "eligible",
      shouldAutoSave: true
    });
  });

  it("does not auto-save Airbnb or already saved Leasebreak listings", () => {
    expect(
      decideLeasebreakAutoSave({
        allowAutoSaveCurrentPage: true,
        alreadyAttempted: false,
        currentTabUrl: "https://www.airbnb.com/rooms/12345",
        matchesByUrl: {},
        page: {
          source: "airbnb",
          status: "listing_page"
        },
        requestedUrls: ["https://www.airbnb.com/rooms/12345"],
        settings: normalizeExtensionSettings({ autoSaveLeasebreakListings: true })
      }).reason
    ).toBe("not_leasebreak_listing");

    expect(
      decideLeasebreakAutoSave({
        allowAutoSaveCurrentPage: true,
        alreadyAttempted: false,
        currentTabUrl: leasebreakUrl,
        matchesByUrl: {
          [leasebreakUrl]: {
            canonicalUrl: "https://www.leasebreak.com/short-term-rental-details/chelsea-studio",
            lastConfirmedAt: "2026-04-26T12:00:00.000Z",
            listingId: "listing-1",
            savedAt: "2026-04-26T12:00:00.000Z",
            sourceUrl: leasebreakUrl,
            status: "needs_cleanup",
            title: "Chelsea studio"
          }
        },
        page: leasebreakListingPage,
        requestedUrls: [leasebreakUrl],
        settings: normalizeExtensionSettings({ autoSaveLeasebreakListings: true })
      }).reason
    ).toBe("already_saved");
  });

  it("does not repeat auto-save for the same Leasebreak canonical URL", () => {
    expect(
      decideLeasebreakAutoSave({
        allowAutoSaveCurrentPage: true,
        alreadyAttempted: true,
        currentTabUrl: leasebreakUrl,
        matchesByUrl: {},
        page: leasebreakListingPage,
        requestedUrls: [leasebreakUrl],
        settings: normalizeExtensionSettings({ autoSaveLeasebreakListings: true })
      })
    ).toMatchObject({
      canonicalUrl: "https://www.leasebreak.com/short-term-rental-details/chelsea-studio",
      reason: "already_attempted",
      shouldAutoSave: false
    });
  });
});

describe("API connection checks", () => {
  it("reports connected when health and protected settings pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("ok", { status: 200 }))
        .mockResolvedValueOnce(new Response("ok", { status: 200 }))
    );

    await expect(checkApiConnection(normalizeExtensionSettings({}))).resolves.toEqual({
      status: "connected",
      message: "Connected to PAMILA API."
    });
  });

  it("reports token issues when health passes but protected settings reject", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("ok", { status: 200 }))
        .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
    );

    await expect(checkApiConnection(normalizeExtensionSettings({ localToken: "wrong" }))).resolves.toMatchObject({
      status: "token_issue"
    });
  });

  it("reports API offline when health cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));

    await expect(checkApiConnection(normalizeExtensionSettings({}))).resolves.toMatchObject({
      status: "api_offline"
    });
  });

  it("looks up saved listings with the local token header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          matches: {
            "https://www.airbnb.com/rooms/54183564": {
              canonicalUrl: "https://www.airbnb.com/rooms/54183564",
              listingId: "listing-1",
              sourceUrl: "https://www.airbnb.com/rooms/54183564?adults=1",
              status: "needs_cleanup",
              title: "Saved Astoria one bed"
            }
          }
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await lookupSavedListings(
      normalizeExtensionSettings({ localToken: "local-token" }),
      ["https://www.airbnb.com/rooms/54183564?adults=1"],
      "airbnb"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:7410/api/listings/lookup",
      expect.objectContaining({
        body: JSON.stringify({
          source: "airbnb",
          urls: ["https://www.airbnb.com/rooms/54183564?adults=1"]
        }),
        headers: expect.objectContaining({
          "X-PAMILA-Token": "local-token"
        }),
        method: "POST"
      })
    );
    expect(response.matches["https://www.airbnb.com/rooms/54183564"]?.listingId).toBe("listing-1");
  });
});

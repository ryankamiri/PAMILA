import { afterEach, describe, expect, it, vi } from "vitest";

import { checkApiConnection } from "./apiClient";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_DISPLAY_NAME,
  HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE,
  HELPER_CHECK_CONNECTION_MESSAGE_TYPE
} from "./captureContract";
import {
  detectListingSource,
  extractApproxAirbnbLocationFromText,
  extractVisibleFieldsFromText,
  normalizeThumbnailCandidates,
  truncateText
} from "./extraction";
import { buildHelperViewModel } from "./helperLogic";
import { classifyExtensionPage } from "./pageClassifier";
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

  it("labels quick-save states for saved and blocked listing pages", () => {
    const page = {
      source: "airbnb" as const,
      status: "listing_page" as const
    };

    expect(buildHelperViewModel(page, "connected", "saved")).toMatchObject({
      quickSaveAction: "disabled",
      quickSaveLabel: "Saved to PAMILA",
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
});

describe("approximate Airbnb location extraction", () => {
  it("extracts a visible location label", () => {
    expect(extractApproxAirbnbLocationFromText("Where you'll be Chelsea, New York, United States")).toEqual({
      label: "Chelsea",
      neighborhood: "Chelsea"
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
});

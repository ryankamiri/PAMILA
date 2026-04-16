import { describe, expect, it } from "vitest";

import { DEFAULT_EXTENSION_SETTINGS, EXTENSION_DISPLAY_NAME } from "./captureContract";
import {
  detectListingSource,
  extractApproxAirbnbLocationFromText,
  extractVisibleFieldsFromText,
  normalizeThumbnailCandidates,
  truncateText
} from "./extraction";
import { normalizeExtensionSettings } from "./settings";

describe("extension scaffold", () => {
  it("names the capture helper", () => {
    expect(EXTENSION_DISPLAY_NAME).toBe("PAMILA Capture");
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

import { describe, expect, it } from "vitest";

import { DEFAULT_LOCAL_PORTS, DEFAULT_SEARCH_SETTINGS, RAMP_OFFICE } from "./defaults.js";

describe("PAMILA defaults", () => {
  it("captures the shared Ramp and search defaults", () => {
    expect(RAMP_OFFICE.address).toContain("28 West 23rd Street");
    expect(DEFAULT_SEARCH_SETTINGS.maxMonthlyRent).toBe(3600);
    expect(DEFAULT_SEARCH_SETTINGS.defaultBedroomFilter).toBe("studio_or_1br");
    expect(DEFAULT_LOCAL_PORTS.api).toBe(7410);
  });
});

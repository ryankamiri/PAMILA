import type { LocalPorts, SearchSettings } from "./types.js";

export const RAMP_OFFICE = {
  address: "28 West 23rd Street, Floor 2, New York, NY 10010",
  name: "Ramp NYC"
} as const;

export const TARGET_DATES = {
  primaryStart: "2026-06-30",
  secondaryStart: "2026-07-01",
  end: "2026-09-12"
} as const;

export const DEFAULT_LOCAL_PORTS: LocalPorts = {
  api: 7410,
  openTripPlanner: 8080,
  web: 5173
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  acceptableCommuteMinutes: 35,
  defaultBedroomFilter: "studio_or_1br",
  fallbackStayType: "private_room",
  heavyWalkMinutes: 15,
  idealCommuteMinutes: 20,
  longWalkMinutes: 10,
  maxMonthlyRent: 3600,
  normalStayType: "entire_apartment",
  officeAddress: RAMP_OFFICE.address,
  officeName: RAMP_OFFICE.name,
  panicModeEnabled: false,
  targetEnd: TARGET_DATES.end,
  targetStartPrimary: TARGET_DATES.primaryStart,
  targetStartSecondary: TARGET_DATES.secondaryStart
};

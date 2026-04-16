import { describe, expect, it } from "vitest";

import {
  buildOtpGraphqlRequest,
  createManualCommuteEstimate,
  mapOtpPlanResponse,
  requestOtpCommute,
  validateOtpOrigin,
  type OtpCommuteOrigin
} from "./otpAdapter.js";

const chelseaOrigin: OtpCommuteOrigin = {
  confidence: "exact",
  isUserConfirmed: true,
  label: "Chelsea listing",
  lat: 40.7465,
  lng: -74.0014,
  source: "exact_address"
};

describe("otpAdapter", () => {
  it("builds a Ramp-arrival OTP GraphQL request around 9 AM", () => {
    const request = buildOtpGraphqlRequest({ lat: 40.7465, lon: -74.0014 });

    expect(request.operationName).toBe("PamilaCommute");
    expect(request.query).toContain("planConnection");
    expect(request.query).toContain('latestArrival: "2026-07-01T09:00:00-04:00"');
    expect(request.query).toContain("latitude: 40.7465");
    expect(request.query).toContain("SUBWAY");
    expect(request.query).toContain("BUS");
  });

  it("maps a subway-only route into a commute summary", () => {
    const mapped = mapOtpPlanResponse(
      otpResponse([
        itinerary([
          leg("WALK", 300),
          leg("SUBWAY", 900, "N"),
          leg("WALK", 180)
        ])
      ])
    );

    expect(mapped.status).toBe("ok");
    if (mapped.status !== "ok") {
      return;
    }
    expect(mapped.summary.totalMinutes).toBe(23);
    expect(mapped.summary.walkMinutes).toBe(8);
    expect(mapped.summary.transferCount).toBe(0);
    expect(mapped.summary.lineNames).toEqual(["N"]);
    expect(mapped.summary.hasBusHeavyRoute).toBe(false);
  });

  it("counts subway transfers and extracts route lines", () => {
    const mapped = mapOtpPlanResponse(
      otpResponse([
        itinerary([
          leg("WALK", 240),
          leg("SUBWAY", 480, "L"),
          leg("SUBWAY", 600, "F"),
          leg("WALK", 120)
        ])
      ])
    );

    expect(mapped.status).toBe("ok");
    if (mapped.status !== "ok") {
      return;
    }
    expect(mapped.summary.totalMinutes).toBe(24);
    expect(mapped.summary.transferCount).toBe(1);
    expect(mapped.summary.routeSummary).toBe("L -> F");
    expect(mapped.summary.lineNames).toEqual(["L", "F"]);
  });

  it("keeps long walking time visible in the summary", () => {
    const mapped = mapOtpPlanResponse(
      otpResponse([
        itinerary([
          leg("WALK", 780),
          leg("SUBWAY", 600, "1"),
          leg("WALK", 120)
        ])
      ])
    );

    expect(mapped.status).toBe("ok");
    if (mapped.status !== "ok") {
      return;
    }
    expect(mapped.summary.walkMinutes).toBe(15);
    expect(mapped.summary.routeSummary).toBe("1");
  });

  it("marks routes as bus-heavy when bus is the main in-vehicle leg", () => {
    const mapped = mapOtpPlanResponse(
      otpResponse([
        itinerary([
          leg("WALK", 180),
          leg("BUS", 900, "M23-SBS"),
          leg("SUBWAY", 120, "R"),
          leg("WALK", 180)
        ])
      ])
    );

    expect(mapped.status).toBe("ok");
    if (mapped.status !== "ok") {
      return;
    }
    expect(mapped.summary.hasBusHeavyRoute).toBe(true);
    expect(mapped.summary.lineNames).toEqual(["M23-SBS", "R"]);
  });

  it("returns no_route when OTP has no itineraries", () => {
    const mapped = mapOtpPlanResponse(otpResponse([]));

    expect(mapped).toMatchObject({
      status: "no_route"
    });
  });

  it("returns otp_unavailable when the OTP request fails", async () => {
    const result = await requestOtpCommute(chelseaOrigin, {
      fetcher: async () => {
        throw new Error("connection refused");
      }
    });

    expect(result.status).toBe("otp_unavailable");
    if (result.status === "ok") {
      return;
    }
    expect(result.message).toContain("connection refused");
    expect(result.externalDirectionsUrl).toContain("google.com/maps/dir");
  });

  it("returns a low-confidence origin error when coordinates are missing", () => {
    const validation = validateOtpOrigin({
      confidence: "medium",
      label: "Address-only listing",
      source: "cross_streets"
    });

    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.message).toContain("latitude/longitude");
  });

  it("builds a manual fallback shape compatible with commute storage", () => {
    const manual = createManualCommuteEstimate(
      {
        hasBusHeavyRoute: true,
        lineNames: ["M23-SBS"],
        routeSummary: "M23-SBS crosstown",
        totalMinutes: 22.4,
        transferCount: 0,
        walkMinutes: 6
      },
      new Date("2026-04-16T12:00:00.000Z")
    );

    expect(manual).toEqual({
      calculatedAt: "2026-04-16T12:00:00.000Z",
      confidence: "manual",
      hasBusHeavyRoute: true,
      lineNames: ["M23-SBS"],
      routeSummary: "M23-SBS crosstown",
      totalMinutes: 22,
      transferCount: 0,
      walkMinutes: 6
    });
  });
});

function otpResponse(itineraries: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    data: {
      planConnection: {
        edges: itineraries.map((node) => ({ node }))
      }
    }
  };
}

function itinerary(legs: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    duration: legs.reduce((sum, current) => sum + Number(current.duration ?? 0), 0),
    end: "2026-07-01T09:00:00-04:00",
    legs,
    start: "2026-07-01T08:35:00-04:00"
  };
}

function leg(mode: string, duration: number, routeShortName?: string): Record<string, unknown> {
  const base = {
    distance: duration,
    duration,
    from: { name: "Origin" },
    mode,
    to: { name: "Destination" }
  };

  if (!routeShortName) {
    return base;
  }

  return {
    ...base,
    route: {
      longName: `${routeShortName} route`,
      mode,
      shortName: routeShortName
    }
  };
}

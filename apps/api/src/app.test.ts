import { describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";

const token = "test-token";
const authHeaders = {
  "x-pamila-token": token
};

describe("api", () => {
  it("responds to health checks without auth", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "pamila-api",
      status: "ok"
    });
  });

  it("requires local token auth for api routes", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const response = await app.inject({
      method: "GET",
      url: "/api/settings"
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "unauthorized"
    });
  });

  it("allows local browser dev origins when Vite falls back to another port", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const response = await app.inject({
      headers: {
        ...authHeaders,
        origin: "http://127.0.0.1:5174"
      },
      method: "GET",
      url: "/api/settings"
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5174");
  });

  it("reads and updates settings", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const initial = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/settings"
    });

    const updated = await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        maxMonthlyRent: 3500,
        panicModeEnabled: true
      },
      url: "/api/settings"
    });

    await app.close();

    expect(initial.statusCode).toBe(200);
    expect(initial.json().settings.officeName).toBe("Ramp NYC");
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings.maxMonthlyRent).toBe(3500);
    expect(updated.json().settings.panicModeEnabled).toBe(true);
  });

  it("creates, lists, updates, recalculates, and deletes listings", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        bathroomType: "private",
        bedroomCount: 1,
        earliestMoveIn: "2026-07-01",
        furnished: "yes",
        kitchen: "yes",
        monthlyRent: 3400,
        source: "leasebreak",
        sourceUrl: "https://www.leasebreak.com/listing/abc?utm_source=x",
        stayType: "entire_apartment",
        title: "Flatiron one bed",
        washer: "in_building"
      },
      url: "/api/listings"
    });

    const createdBody = created.json();
    const id = createdBody.listing.id;

    const listed = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/listings"
    });

    const patched = await app.inject({
      headers: authHeaders,
      method: "PATCH",
      payload: {
        status: "shortlisted",
        userNotes: "Message today."
      },
      url: `/api/listings/${id}`
    });

    const recalculated = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/recalculate-score`
    });

    const deleted = await app.inject({
      headers: authHeaders,
      method: "DELETE",
      url: `/api/listings/${id}`
    });

    await app.close();

    expect(created.statusCode).toBe(201);
    expect(createdBody.listing.scoreBreakdown.totalScore).toBeGreaterThan(0);
    expect(listed.json().listings).toHaveLength(1);
    expect(patched.json().listing.status).toBe("shortlisted");
    expect(recalculated.json().scoreBreakdown.hardFilterStatus).toBe("needs_cleanup");
    expect(deleted.statusCode).toBe(204);
  });

  it("clears local listing history through an authenticated endpoint and preserves settings", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const settingsUpdate = await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        maxMonthlyRent: 4100,
        panicModeEnabled: true
      },
      url: "/api/settings"
    });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        bedroomCount: 1,
        monthlyRent: 3200,
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/clear-history",
        stayType: "entire_apartment",
        title: "Clear history listing"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        confidence: "high",
        geographyCategory: "manhattan",
        isUserConfirmed: true,
        label: "Chelsea",
        neighborhood: "Chelsea",
        source: "neighborhood"
      },
      url: `/api/listings/${id}/location`
    });
    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        lineNames: ["F"],
        totalMinutes: 18
      },
      url: `/api/listings/${id}/commute`
    });
    await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Captured page text",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Clear history listing",
        url: "https://www.airbnb.com/rooms/clear-history?check_in=2026-06-30",
        visibleFields: {}
      },
      url: "/api/captures"
    });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/listings/clear-history"
    });
    const cleared = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: "/api/listings/clear-history"
    });
    const backup = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/exports/backup.json"
    });

    await app.close();

    expect(settingsUpdate.statusCode).toBe(200);
    expect(unauthorized.statusCode).toBe(401);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().deletedCount).toBe(1);
    expect(cleared.json().listings).toEqual([]);
    expect(cleared.json().settings.maxMonthlyRent).toBe(4100);
    expect(cleared.json().settings.panicModeEnabled).toBe(true);
    expect(backup.json().listings).toEqual([]);
    expect(backup.json().captures).toEqual([]);
    expect(backup.json().locations).toEqual([]);
    expect(backup.json().commuteEstimates).toEqual([]);
    expect(backup.json().statusEvents).toEqual([]);
  });

  it("looks up saved listings by canonical source URL", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        bedroomCount: 1,
        monthlyRent: 3200,
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/54183564?check_in=2026-06-30&utm_campaign=x",
        stayType: "entire_apartment",
        title: "Saved Airbnb one bed"
      },
      url: "/api/listings"
    });

    const unauthorized = await app.inject({
      method: "POST",
      payload: {
        urls: ["https://www.airbnb.com/rooms/54183564?adults=1"]
      },
      url: "/api/listings/lookup"
    });

    const lookup = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "airbnb",
        urls: [
          "https://www.airbnb.com/rooms/54183564?adults=1&check_out=2026-09-12",
          "https://www.airbnb.com/rooms/not-saved"
        ]
      },
      url: "/api/listings/lookup"
    });

    await app.close();

    const canonicalUrl = "https://www.airbnb.com/rooms/54183564";
    expect(created.statusCode).toBe(201);
    expect(unauthorized.statusCode).toBe(401);
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().matches[canonicalUrl]).toMatchObject({
      canonicalUrl,
      listingId: created.json().listing.id,
      sourceUrl: "https://www.airbnb.com/rooms/54183564?check_in=2026-06-30&utm_campaign=x",
      status: "new",
      title: "Saved Airbnb one bed"
    });
    expect(Object.keys(lookup.json().matches)).toEqual([canonicalUrl]);
  });

  it("removes only clearly dead source links when requested", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("dead-listing")) {
        return new Response("", { status: 404 });
      }
      if (url.includes("blocked-listing")) {
        return new Response("", { status: 403 });
      }
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const app = buildApp({ databaseUrl: ":memory:", fetchImpl: fetchMock, token });

    const alive = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/alive-listing",
        title: "Alive Airbnb"
      },
      url: "/api/listings"
    });
    const dead = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "leasebreak",
        sourceUrl: "https://www.leasebreak.com/short-term-rental-details/dead-listing",
        title: "Dead Leasebreak"
      },
      url: "/api/listings"
    });
    const blocked = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/blocked-listing",
        title: "Blocked Airbnb"
      },
      url: "/api/listings"
    });

    const pruned = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: "/api/listings/prune-dead-links"
    });

    await app.close();

    expect(pruned.statusCode).toBe(200);
    expect(pruned.json().checkedCount).toBe(3);
    expect(pruned.json().removedCount).toBe(1);
    expect(pruned.json().removed).toEqual([
      expect.objectContaining({
        id: dead.json().listing.id,
        reason: "source_returned_404",
        status: 404
      })
    ]);
    expect(pruned.json().warnings.join(" ")).toContain("Source returned 403");
    expect(pruned.json().listings.map((listing: { id: string }) => listing.id).sort()).toEqual(
      [alive.json().listing.id, blocked.json().listing.id].sort()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.leasebreak.com/short-term-rental-details/dead-listing",
      expect.objectContaining({ method: "HEAD" })
    );
  });

  it("stores manual location and commute estimates and recalculates scores", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        bedroomCount: 0,
        earliestMoveIn: "2026-07-01",
        latestMoveOut: "2026-09-12",
        monthlyRent: 3200,
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/location-commute",
        stayType: "entire_apartment",
        title: "Chelsea studio"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    const location = await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        location: {
          confidence: "high",
          geographyCategory: "manhattan",
          isUserConfirmed: true,
          label: "Chelsea",
          neighborhood: "Chelsea",
          source: "neighborhood"
        }
      },
      url: `/api/listings/${id}/location`
    });

    const commute = await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        checkedAt: "2026-04-16T12:00:00.000Z",
        commute: {
          hasBusHeavyRoute: false,
          lineNames: ["F", "M"],
          routeSummary: "F/M to 23 St",
          totalMinutes: 18,
          transferCount: 0,
          walkMinutes: 5
        }
      },
      url: `/api/listings/${id}/commute/manual`
    });

    const fetchedLocation = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}/location`
    });

    const fetchedCommute = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}/commute`
    });

    await app.close();

    expect(location.statusCode).toBe(200);
    expect(location.json().location.geographyCategory).toBe("manhattan");
    expect(location.json().listing.location.label).toBe("Chelsea");
    expect(commute.statusCode).toBe(200);
    expect(commute.json().commute.totalMinutes).toBe(18);
    expect(commute.json().listing.commute.totalMinutes).toBe(18);
    expect(commute.json().listing.lastCommuteCheckedAt).toBe("2026-04-16T12:00:00.000Z");
    expect(commute.json().listing.scoreBreakdown.scoreExplanation).toContain("18 minutes");
    expect(fetchedLocation.json().location.label).toBe("Chelsea");
    expect(fetchedCommute.json().commute.lineNames).toEqual(["F", "M"]);
  });

  it("imports extension captures into inbox listings", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const response = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Entire rental unit in Chelsea. $3,200 month.",
        selectedText: "Washer in building",
        source: "airbnb",
        thumbnailCandidates: [{ height: 200, url: "https://example.com/thumb.jpg", width: 300 }],
        title: "Chelsea studio",
        url: "https://www.airbnb.com/rooms/123?check_in=2026-07-01&utm_campaign=x",
        visibleFields: {
          price: "$3,200 month"
        }
      },
      url: "/api/captures"
    });

    const listings = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/listings"
    });

    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().capture.thumbnailCandidates[0].url).toBe("https://example.com/thumb.jpg");
    expect(response.json().listing.monthlyRent).toBe(3200);
    expect(response.json().listing.status).toBe("needs_cleanup");
    expect(response.json().suggestions.locationSuggestion.neighborhood).toBe("Chelsea");
    expect(listings.json().listings).toHaveLength(1);
  });

  it("deduplicates captures by canonical source URL", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const first = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Entire rental unit in Chelsea. $3,200 per month.",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Chelsea studio",
        url: "https://www.airbnb.com/rooms/555?check_in=2026-07-01&utm_campaign=x",
        visibleFields: {}
      },
      url: "/api/captures"
    });

    const second = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Updated selected text",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Chelsea studio updated",
        url: "https://www.airbnb.com/rooms/555?check_out=2026-09-12",
        visibleFields: {}
      },
      url: "/api/captures"
    });

    const listings = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/listings"
    });

    const captures = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${first.json().listing.id}/captures`
    });

    await app.close();

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().listing.id).toBe(first.json().listing.id);
    expect(listings.json().listings).toHaveLength(1);
    expect(captures.json().captures).toHaveLength(2);
  });

  it("prefers Airbnb high-confidence fields over noisy page text", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const response = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText:
          "Cozy Flat in the Heart of the Upper West Side. Original $4,051. Studio nearby. Entire rental unit. 1 guest · 1 bedroom · 1 bed · 1 bath.",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Cozy Flat in the Heart of the Upper West Side",
        url: "https://www.airbnb.com/rooms/45729644?adults=1",
        visibleFields: {
          airbnb_availability_summary: "Available Jun 30, 2026 to Sep 12, 2026",
          airbnb_bedroom_count: "1",
          airbnb_bedroom_summary: "1 guest · 1 bedroom · 1 bed · 1 bath",
          airbnb_current_monthly_rent: "$3,518 monthly",
          airbnb_location_label: "Upper West Side"
        }
      },
      url: "/api/captures"
    });

    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().listing.monthlyRent).toBe(3518);
    expect(response.json().listing.bedroomCount).toBe(1);
    expect(response.json().listing.bedroomLabel).toBe("1BR");
    expect(response.json().listing.availabilitySummary).toBe("Available Jun 30, 2026 to Sep 12, 2026");
    expect(response.json().suggestions.locationSuggestion.label).toBe("Upper West Side");
  });

  it("imports discounted Airbnb current monthly rent from visible text", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const response = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Entire rental unit in Chelsea. Reserve $4,030 monthly $3,518 monthly. 1 guest · 1 bedroom · 1 bed · 1 bath.",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Discounted Chelsea Airbnb",
        url: "https://www.airbnb.com/rooms/discounted-current-rent",
        visibleFields: {}
      },
      url: "/api/captures"
    });

    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().listing.monthlyRent).toBe(3518);
  });

  it("imports Leasebreak bedroom count and stay type from detail-page fields", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const response = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText:
          "The Basics Bedrooms: 1 Bathrooms: 1 (Private) Decor: Furnished Only $3,200/mo Listing type: Short Term Rental Posted by: Professional Landlord Property Details This spacious and bright apartment can be used as a convertible 2 bedroom or as a 1 bedroom with office space.",
        source: "leasebreak",
        thumbnailCandidates: [],
        title: "486 9th Avenue",
        url: "https://www.leasebreak.com/short-term-rental-details/382087/486-9th-avenue",
        visibleFields: {
          bedroom_candidate: "1 bedroom",
          leasebreak_address: "486 9th Avenue",
          leasebreak_bedroom_count: "1",
          leasebreak_listing_type: "Short Term Rental",
          leasebreak_neighborhood: "Midtown West / Hell's Kitchen",
          move_in_urgency_candidate: "immediate",
          monthly_rent_candidate: "$3,200/mo",
          stay_type_candidate: "entire_apartment"
        }
      },
      url: "/api/captures"
    });

    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().listing.bedroomCount).toBe(1);
    expect(response.json().listing.bedroomLabel).toBe("1BR");
    expect(response.json().listing.monthlyRent).toBe(3200);
    expect(response.json().listing.stayType).toBe("entire_apartment");
    expect(response.json().listing.availabilitySummary).toBe("Immediate move-in listed");
    expect(response.json().listing.location).toMatchObject({
      address: "486 9th Avenue, New York, NY",
      label: "486 9th Avenue",
      neighborhood: "Midtown West / Hell's Kitchen",
      source: "exact_address"
    });
  });

  it("auto-fixes bad Airbnb rent and bedroom values on re-capture", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        availabilitySummary: "Skip to content Homes Homes NEW NEW Experiences Experiences",
        bedroomCount: 0,
        bedroomLabel: "Studio",
        monthlyRent: 4051,
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/45729644?check_in=2026-06-30",
        stayType: "entire_apartment",
        title: "Cozy Flat"
      },
      url: "/api/listings"
    });

    const recaptured = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Entire rental unit. $4,030 $3,518 monthly. 1 guest · 1 bedroom · 1 bed · 1 bath. 74 nights in New York Jun 30, 2026 - Sep 12, 2026.",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Cozy Flat in the Heart of the Upper West Side",
        url: "https://www.airbnb.com/rooms/45729644?check_out=2026-09-12",
        visibleFields: {
          airbnb_bedroom_count: "1",
          airbnb_bedroom_summary: "1 guest · 1 bedroom · 1 bed · 1 bath",
          airbnb_availability_summary: "Available Jun 30, 2026 to Sep 12, 2026",
          airbnb_current_monthly_rent: "$3,518 monthly",
          airbnb_original_monthly_rent: "$4,030 monthly"
        }
      },
      url: "/api/captures"
    });

    const fetched = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${created.json().listing.id}`
    });

    await app.close();

    expect(recaptured.statusCode).toBe(201);
    expect(recaptured.json().listing.id).toBe(created.json().listing.id);
    expect(recaptured.json().correctionMode).toBe("auto_fixed");
    expect(recaptured.json().appliedCorrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "monthlyRent", nextValue: 3518, previousValue: 4051 }),
        expect.objectContaining({ field: "bedroomCount", nextValue: 1, previousValue: 0 }),
        expect.objectContaining({ field: "bedroomLabel", nextValue: "1BR", previousValue: "Studio" }),
        expect.objectContaining({
          field: "availabilitySummary",
          nextValue: "Available Jun 30, 2026 to Sep 12, 2026"
        })
      ])
    );
    expect(fetched.json().listing.monthlyRent).toBe(3518);
    expect(fetched.json().listing.bedroomCount).toBe(1);
    expect(fetched.json().listing.bedroomLabel).toBe("1BR");
    expect(fetched.json().listing.availabilitySummary).toBe("Available Jun 30, 2026 to Sep 12, 2026");
  });

  it("saves approximate Airbnb location but does not overwrite user-confirmed exact location", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/location-fix",
        title: "Airbnb location"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    const firstCapture = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        approxLocation: {
          address: null,
          confidence: "medium",
          crossStreets: null,
          geographyCategory: "manhattan",
          isUserConfirmed: false,
          label: "Upper West Side",
          lat: 40.784,
          lng: -73.973,
          neighborhood: "Upper West Side",
          source: "airbnb_approx_pin"
        },
        pageText: "Where you'll be New York, United States",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Airbnb location",
        url: "https://www.airbnb.com/rooms/location-fix?check_in=2026-06-30",
        visibleFields: {
          airbnb_location_label: "Upper West Side"
        }
      },
      url: "/api/captures"
    });

    const approximateLocation = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}/location`
    });

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        address: "28 West 23rd Street",
        confidence: "exact",
        geographyCategory: "manhattan",
        isUserConfirmed: true,
        label: "28 West 23rd Street",
        source: "exact_address"
      },
      url: `/api/listings/${id}/location`
    });

    await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        approxLocation: {
          address: null,
          confidence: "medium",
          crossStreets: null,
          geographyCategory: "lic_astoria",
          isUserConfirmed: false,
          label: "Astoria",
          lat: 40.765,
          lng: -73.92,
          neighborhood: "Astoria",
          source: "airbnb_approx_pin"
        },
        pageText: "Where you'll be Astoria, Queens",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Airbnb location",
        url: "https://www.airbnb.com/rooms/location-fix?check_out=2026-09-12",
        visibleFields: {
          airbnb_location_label: "Astoria"
        }
      },
      url: "/api/captures"
    });

    const finalLocation = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}/location`
    });

    await app.close();

    expect(firstCapture.statusCode).toBe(201);
    expect(approximateLocation.json().location).toMatchObject({
      label: "Upper West Side",
      lat: 40.784,
      lng: -73.973,
      source: "airbnb_approx_pin"
    });
    expect(finalLocation.json().location).toMatchObject({
      address: "28 West 23rd Street",
      isUserConfirmed: true,
      label: "28 West 23rd Street",
      source: "exact_address"
    });
  });

  it("geocodes a saved listing location when triggered", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ lat: "40.7421", lon: "-73.9916" }]), { status: 200 })
    );
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      geocoderUrl: "https://geocode.test/search",
      token
    });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "leasebreak",
        sourceUrl: "https://www.leasebreak.com/listing/geocode",
        title: "Geocode Flatiron"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        address: "28 West 23rd Street",
        confidence: "exact",
        geographyCategory: "manhattan",
        isUserConfirmed: true,
        label: "Flatiron",
        source: "exact_address"
      },
      url: `/api/listings/${id}/location`
    });

    const geocoded = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/location/geocode`
    });

    await app.close();

    expect(geocoded.statusCode).toBe(200);
    expect(geocoded.json().status).toBe("ok");
    expect(geocoded.json().location.lat).toBe(40.7421);
    expect(geocoded.json().listing.location.lng).toBe(-73.9916);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns geocode no-result and missing-query states without changing data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      geocoderUrl: "https://geocode.test/search",
      token
    });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/geocode-empty",
        title: "Geocode missing"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    const missing = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/location/geocode`
    });

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        label: "Mystery neighborhood",
        source: "neighborhood"
      },
      url: `/api/listings/${id}/location`
    });

    const noResult = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/location/geocode`
    });

    await app.close();

    expect(missing.json().status).toBe("missing_query");
    expect(noResult.json().status).toBe("no_result");
    expect(noResult.json().location.lat).toBeNull();
  });

  it("calculates OTP commute when coordinates are present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            planConnection: {
              edges: [
                {
                  node: {
                    duration: 1080,
                    legs: [
                      { duration: 300, mode: "WALK" },
                      {
                        duration: 600,
                        legGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
                        mode: "SUBWAY",
                        route: { longName: "N route", mode: "SUBWAY", shortName: "N" }
                      },
                      { duration: 180, mode: "WALK" }
                    ]
                  }
                }
              ]
            }
          }
        }),
        { status: 200 }
      )
    );
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      otpUrl: "https://otp.test/otp/gtfs/v1",
      token
    });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        bedroomCount: 0,
        earliestMoveIn: "2026-07-01",
        latestMoveOut: "2026-09-12",
        monthlyRent: 3200,
        source: "leasebreak",
        sourceUrl: "https://www.leasebreak.com/listing/otp",
        stayType: "entire_apartment",
        title: "OTP studio"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        confidence: "exact",
        geographyCategory: "manhattan",
        isUserConfirmed: true,
        label: "Chelsea",
        lat: 40.7465,
        lng: -74.0014,
        source: "exact_address"
      },
      url: `/api/listings/${id}/location`
    });

    const calculated = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/commute/calculate`
    });

    await app.close();

    expect(calculated.statusCode).toBe(200);
    expect(calculated.json().status).toBe("ok");
    expect(calculated.json().commute.totalMinutes).toBe(18);
    expect(calculated.json().routeDetail.legs[1].geometry).toHaveLength(3);
    expect(calculated.json().routeDetail.legs[1].lineName).toBe("N");
    expect(calculated.json().listing.commute.lineNames).toEqual(["N"]);
    expect(calculated.json().listing.routeDetail.legs[1].style).toBe("rail");
    expect(calculated.json().listing.scoreBreakdown.scoreExplanation).toContain("18 minutes");
  });

  it("keeps manual commute fallback when OTP cannot calculate", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection refused"));
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      otpUrl: "https://otp.test/otp/gtfs/v1",
      token
    });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "airbnb",
        sourceUrl: "https://www.airbnb.com/rooms/otp-fallback",
        title: "OTP fallback"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    const missingLocation = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/commute/calculate`
    });

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        confidence: "exact",
        geographyCategory: "manhattan",
        label: "Chelsea",
        lat: 40.7465,
        lng: -74.0014,
        source: "exact_address"
      },
      url: `/api/listings/${id}/location`
    });

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        totalMinutes: 22,
        routeSummary: "Manual route"
      },
      url: `/api/listings/${id}/commute`
    });

    const otpDown = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/commute/calculate`
    });

    await app.close();

    expect(missingLocation.json().status).toBe("missing_location");
    expect(missingLocation.json().routeDetail).toBeNull();
    expect(otpDown.json().status).toBe("otp_unavailable");
    expect(otpDown.json().commute.totalMinutes).toBe(22);
    expect(otpDown.json().routeDetail).toBeNull();
    expect(otpDown.json().warnings[0]).toContain("connection refused");
  });

  it("prepares route with captured approximate location, geocoding, and OTP route detail", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.startsWith("https://geocode.test")) {
        return new Response(JSON.stringify([{ lat: "40.7465", lon: "-74.0014" }]), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          data: {
            planConnection: {
              edges: [
                {
                  node: {
                    duration: 1080,
                    legs: [
                      { duration: 300, legGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }, mode: "WALK" },
                      {
                        duration: 600,
                        legGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
                        mode: "SUBWAY",
                        route: { longName: "N route", mode: "SUBWAY", shortName: "N" }
                      },
                      { duration: 180, legGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }, mode: "WALK" }
                    ]
                  }
                }
              ]
            }
          }
        }),
        { status: 200 }
      );
    });
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      geocoderUrl: "https://geocode.test/search",
      otpUrl: "https://otp.test/otp/gtfs/v1",
      token
    });

    const imported = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Entire apartment in Chelsea. $3,200 monthly. Studio.",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Chelsea Airbnb",
        url: "https://www.airbnb.com/rooms/prepare-success",
        visibleFields: {}
      },
      url: "/api/captures"
    });
    const id = imported.json().listing.id;

    const prepared = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/commute/prepare`
    });
    const fetchedLocation = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}/location`
    });
    const fetchedCommute = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}/commute`
    });
    const fetchedListing = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}`
    });

    await app.close();

    expect(prepared.statusCode).toBe(200);
    expect(prepared.json().status).toBe("ok");
    expect(prepared.json().nextStep).toBe("review_route");
    expect(prepared.json().location.lat).toBe(40.7465);
    expect(prepared.json().routeDetail.legs[1].lineName).toBe("N");
    expect(prepared.json().warnings).toContain("Route uses approximate location; confirm exact address before final decision.");
    expect(prepared.json().listing.location.lat).toBe(40.7465);
    expect(prepared.json().listing.routeDetail.legs[1].lineName).toBe("N");
    expect(fetchedLocation.json().location.lat).toBe(40.7465);
    expect(fetchedCommute.json().routeDetail.legs[1].lineName).toBe("N");
    expect(fetchedListing.json().listing.routeDetail.legs[1].lineName).toBe("N");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("prepares a Leasebreak route from captured exact address text", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.startsWith("https://geocode.test")) {
        return new Response(JSON.stringify([{ lat: "40.7421", lon: "-73.9916" }]), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          data: {
            planConnection: {
              edges: [
                {
                  node: {
                    duration: 900,
                    legs: [
                      { duration: 240, legGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }, mode: "WALK" },
                      {
                        duration: 660,
                        legGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
                        mode: "SUBWAY",
                        route: { longName: "R route", mode: "SUBWAY", shortName: "R" }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }),
        { status: 200 }
      );
    });
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      geocoderUrl: "https://geocode.test/search",
      otpUrl: "https://otp.test/otp/gtfs/v1",
      token
    });

    const imported = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Studio near Flatiron. Available now.",
        source: "leasebreak",
        thumbnailCandidates: [],
        title: "Flatiron Leasebreak",
        url: "https://www.leasebreak.com/listing/prepare-leasebreak",
        visibleFields: {
          address: "28 West 23rd Street"
        }
      },
      url: "/api/captures"
    });
    const id = imported.json().listing.id;

    const prepared = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/commute/prepare`
    });
    const fetchedListing = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}`
    });

    await app.close();

    expect(imported.json().listing.location).toMatchObject({
      address: "28 West 23rd Street, New York, NY",
      source: "exact_address"
    });
    expect(prepared.json().status).toBe("ok");
    expect(prepared.json().location.lat).toBe(40.7421);
    expect(prepared.json().routeDetail.legs[1].lineName).toBe("R");
    expect(fetchedListing.json().listing.location.lat).toBe(40.7421);
    expect(fetchedListing.json().listing.routeDetail.legs[1].lineName).toBe("R");
  });

  it("prepares route with clear no-location and geocode no-result blockers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      geocoderUrl: "https://geocode.test/search",
      token
    });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "leasebreak",
        sourceUrl: "https://www.leasebreak.com/listing/prepare-blockers",
        title: "Prepare blockers"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    const noLocation = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/commute/prepare`
    });

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        confidence: "medium",
        geographyCategory: "brooklyn",
        label: "Williamsburg",
        neighborhood: "Williamsburg",
        source: "neighborhood"
      },
      url: `/api/listings/${id}/location`
    });

    const noResult = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/commute/prepare`
    });

    await app.close();

    expect(noLocation.json().status).toBe("missing_location");
    expect(noLocation.json().nextStep).toBe("add_location");
    expect(noLocation.json().warnings).toEqual(["No location text was captured yet."]);
    expect(noResult.json().status).toBe("no_result");
    expect(noResult.json().nextStep).toBe("enter_coordinates");
    expect(noResult.json().warnings).toEqual([
      "Could not find coordinates for this location; enter lat/lng manually."
    ]);
  });

  it("prepares route without overwriting manual commute when OTP is unavailable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection refused"));
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      otpUrl: "https://otp.test/otp/gtfs/v1",
      token
    });

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        source: "leasebreak",
        sourceUrl: "https://www.leasebreak.com/listing/prepare-otp-down",
        title: "Prepare OTP down"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        confidence: "exact",
        geographyCategory: "manhattan",
        label: "Chelsea",
        lat: 40.7465,
        lng: -74.0014,
        source: "exact_address"
      },
      url: `/api/listings/${id}/location`
    });

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        routeSummary: "Manual route",
        totalMinutes: 22
      },
      url: `/api/listings/${id}/commute`
    });

    const prepared = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/listings/${id}/commute/prepare`
    });

    await app.close();

    expect(prepared.json().status).toBe("otp_unavailable");
    expect(prepared.json().nextStep).toBe("manual_commute");
    expect(prepared.json().commute.totalMinutes).toBe(22);
    expect(prepared.json().warnings[0]).toBe("OTP is not running; manual commute still works.");
  });

  it("returns deterministic capture suggestions when AI is disabled", async () => {
    const fetchImpl = vi.fn();
    const app = buildApp({ databaseUrl: ":memory:", fetchImpl, openAiApiKey: "test-key", token });

    const imported = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageText: "Entire rental unit in Flatiron. $3,400 monthly. Studio. Laundry in building.",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Flatiron studio",
        url: "https://www.airbnb.com/rooms/ai-disabled",
        visibleFields: {}
      },
      url: "/api/captures"
    });

    const analyzed = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/captures/${imported.json().capture.id}/analyze`
    });

    await app.close();

    expect(analyzed.statusCode).toBe(200);
    expect(analyzed.json().enabled).toBe(false);
    expect(analyzed.json().reason).toBe("ai_disabled");
    expect(analyzed.json().suggestions.suggestedListingUpdate.monthlyRent).toBe(3400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches OpenAI capture analyses by capture hash", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            cleanupActions: [],
            hostQuestions: ["Can you confirm July 1?"],
            locationSuggestion: null,
            riskFlags: [],
            suggestedListingUpdate: {
              monthlyRent: 3300
            },
            summary: "Looks promising."
          })
        }),
        { status: 200 }
      )
    );
    const app = buildApp({
      databaseUrl: ":memory:",
      fetchImpl,
      openAiApiKey: "test-key",
      openAiModel: "gpt-5",
      token
    });

    const imported = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        pageHash: "same-page",
        pageText: "Entire apartment in Chelsea. $3,300 monthly.",
        source: "airbnb",
        thumbnailCandidates: [],
        title: "Chelsea studio",
        url: "https://www.airbnb.com/rooms/ai-cache",
        visibleFields: {}
      },
      url: "/api/captures"
    });

    await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        aiOnCaptureEnabled: true
      },
      url: "/api/settings"
    });

    const first = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/captures/${imported.json().capture.id}/analyze`
    });

    const second = await app.inject({
      headers: authHeaders,
      method: "POST",
      url: `/api/captures/${imported.json().capture.id}/analyze`
    });

    await app.close();

    expect(first.statusCode).toBe(200);
    expect(first.json().enabled).toBe(true);
    expect(first.json().cached).toBe(false);
    expect(first.json().analysis.analysis.summary).toBe("Looks promising.");
    expect(second.json().cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("exports listings as csv and backup json", async () => {
    const app = buildApp({ databaseUrl: ":memory:", token });

    await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        monthlyRent: 3700,
        source: "leasebreak",
        sourceUrl: "https://www.leasebreak.com/listing/too-expensive",
        title: "Over cap"
      },
      url: "/api/listings"
    });

    const csv = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/exports/listings.csv"
    });

    const backup = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/exports/backup.json"
    });

    await app.close();

    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("monthlyRent");
    expect(csv.body).toContain("Over cap");
    expect(backup.statusCode).toBe(200);
    expect(backup.json().listings).toHaveLength(1);
  });

  it("restores listings from backup json", async () => {
    const sourceApp = buildApp({ databaseUrl: ":memory:", token });

    const created = await sourceApp.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        bedroomCount: 1,
        monthlyRent: 3100,
        source: "leasebreak",
        sourceUrl: "https://www.leasebreak.com/listing/restore-api",
        stayType: "entire_apartment",
        title: "Restore API"
      },
      url: "/api/listings"
    });
    const id = created.json().listing.id;

    await sourceApp.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        confidence: "medium",
        geographyCategory: "manhattan",
        label: "Flatiron",
        neighborhood: "Flatiron",
        source: "neighborhood"
      },
      url: `/api/listings/${id}/location`
    });

    const backup = await sourceApp.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/exports/backup.json"
    });
    await sourceApp.close();

    const restoreApp = buildApp({ databaseUrl: ":memory:", token });
    const restored = await restoreApp.inject({
      headers: authHeaders,
      method: "POST",
      payload: backup.json(),
      url: "/api/import/backup"
    });

    const listings = await restoreApp.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/listings"
    });

    const location = await restoreApp.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/listings/${id}/location`
    });

    await restoreApp.close();

    expect(restored.statusCode).toBe(200);
    expect(restored.json().restored.listingsRestored).toBe(1);
    expect(listings.json().listings[0].title).toBe("Restore API");
    expect(location.json().location.neighborhood).toBe("Flatiron");
  });
});

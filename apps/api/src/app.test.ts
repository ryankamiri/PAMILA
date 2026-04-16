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
    expect(response.json().suggestions.locationSuggestion.neighborhood).toBe("chelsea");
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

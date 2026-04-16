import { describe, expect, it } from "vitest";

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
    expect(response.json().listing.status).toBe("needs_cleanup");
    expect(listings.json().listings).toHaveLength(1);
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
});

import { describe, expect, it } from "vitest";

import { canonicalizeUrlForDb, createInMemoryPamilaDb } from "./index.js";

describe("PamilaDatabase", () => {
  it("seeds default Ramp search settings", () => {
    const db = createInMemoryPamilaDb();

    const settings = db.getSettings();

    db.close();

    expect(settings.officeAddress).toContain("28 West 23rd Street");
    expect(settings.maxMonthlyRent).toBe(3600);
    expect(settings.defaultBedroomFilter).toBe("studio_or_1br");
    expect(settings.panicModeEnabled).toBe(false);
  });

  it("creates, updates, lists, and deletes listings", () => {
    const db = createInMemoryPamilaDb();

    const created = db.createListing({
      bedroomCount: 1,
      monthlyRent: 3400,
      source: "leasebreak",
      sourceUrl: "https://www.leasebreak.com/listing/123?utm_source=test",
      stayType: "entire_apartment",
      title: "Chelsea summer sublet"
    });

    const updated = db.updateListing(created.id, {
      status: "shortlisted",
      washer: "in_building"
    });

    const listings = db.listListings();
    const deleted = db.deleteListing(created.id);

    db.close();

    expect(created.canonicalSourceUrl).not.toContain("utm_source");
    expect(updated?.status).toBe("shortlisted");
    expect(updated?.washer).toBe("in_building");
    expect(listings).toHaveLength(1);
    expect(deleted).toBe(true);
  });

  it("imports captures idempotently by canonical source URL", () => {
    const db = createInMemoryPamilaDb();

    const first = db.importCapture({
      approxLocation: null,
      capturedAt: "2026-04-16T12:00:00.000Z",
      pageHash: "abc",
      pageText: "Airbnb page text",
      selectedText: null,
      source: "airbnb",
      thumbnailCandidates: [],
      title: "Sunny Flatiron studio",
      url: "https://www.airbnb.com/rooms/123?check_in=2026-07-01&utm_medium=x",
      visibleFields: {
        price: "$3,200 month"
      }
    });

    const second = db.importCapture({
      approxLocation: null,
      capturedAt: "2026-04-16T12:05:00.000Z",
      pageHash: "def",
      pageText: "Updated page text",
      selectedText: "selected",
      source: "airbnb",
      thumbnailCandidates: [{ height: 200, url: "https://example.com/photo.jpg", width: 300 }],
      title: "Sunny Flatiron studio",
      url: "https://www.airbnb.com/rooms/123?check_out=2026-09-12",
      visibleFields: {
        stayType: "Entire home"
      }
    });

    const listings = db.listListings();
    const captures = db.listCaptures();

    db.close();

    expect(first.listing.id).toBe(second.listing.id);
    expect(listings).toHaveLength(1);
    expect(captures).toHaveLength(2);
    expect(captures[0]?.thumbnailCandidates[0]?.url).toBe("https://example.com/photo.jpg");
  });

  it("stores score breakdowns and backup payloads", () => {
    const db = createInMemoryPamilaDb();
    const listing = db.createListing({
      monthlyRent: 3500,
      source: "leasebreak",
      sourceUrl: "https://www.leasebreak.com/listing/score",
      title: "Score me"
    });

    db.saveScoreBreakdown(listing.id, {
      amenityScore: 6,
      cleanupActions: [{ code: "confirm_address", label: "Confirm address" }],
      commuteScore: 20,
      dateScore: 12,
      hardFilterReasons: [],
      hardFilterStatus: "included",
      locationScore: 15,
      priceScore: 13,
      riskFlags: [{ code: "unknown_washer", label: "Washer unknown", severity: "info" }],
      scoreExplanation: "Good fit.",
      stayBedroomScore: 5,
      totalScore: 71
    });

    const backup = db.createBackup();

    db.close();

    expect(backup.listings[0]?.scoreBreakdown?.totalScore).toBe(71);
    expect(backup.captures).toEqual([]);
    expect(backup.settings.officeName).toBe("Ramp NYC");
  });
});

describe("canonicalizeUrlForDb", () => {
  it("uses the shared stable listing URL policy", () => {
    expect(
      canonicalizeUrlForDb(
        "https://www.airbnb.com/rooms/123?utm_source=x&guests=1&check_in=2026-07-01&a=b"
      )
    ).toBe("https://www.airbnb.com/rooms/123");
  });
});

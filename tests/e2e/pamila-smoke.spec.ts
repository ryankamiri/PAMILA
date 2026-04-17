import { expect, test } from "@playwright/test";

const apiBaseUrl = "http://localhost:7410";
const token = "dev-local-token";
const authHeaders = {
  "x-pamila-token": token
};

test("manual listing, map pin, and extension-shaped capture flow", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const listingTitle = `E2E Flatiron studio ${suffix}`;
  const captureTitle = `E2E Chelsea capture ${suffix}`;

  const created = await request.post(`${apiBaseUrl}/api/listings`, {
    data: {
      bedroomCount: 0,
      earliestMoveIn: "2026-07-01",
      latestMoveOut: "2026-09-12",
      monthlyRent: 3200,
      source: "leasebreak",
      sourceUrl: `https://www.leasebreak.com/listing/e2e-${suffix}`,
      stayType: "entire_apartment",
      title: listingTitle
    },
    headers: authHeaders
  });
  expect(created.ok()).toBe(true);
  const listingId = (await created.json()).listing.id as string;

  const location = await request.put(`${apiBaseUrl}/api/listings/${listingId}/location`, {
    data: {
      address: "28 West 23rd Street",
      confidence: "exact",
      geographyCategory: "manhattan",
      isUserConfirmed: true,
      label: "Flatiron",
      neighborhood: "Flatiron",
      source: "exact_address"
    },
    headers: authHeaders
  });
  expect(location.ok()).toBe(true);
  const locationBody = await location.json();
  const geocodedLocation = {
    ...locationBody.location,
    lat: 40.7421,
    lng: -73.9916
  };
  const geocodedListing = {
    ...locationBody.listing,
    location: geocodedLocation
  };

  const commute = await request.put(`${apiBaseUrl}/api/listings/${listingId}/commute`, {
    data: {
      calculatedAt: "2026-04-17T09:00:00.000Z",
      hasBusHeavyRoute: false,
      lineNames: ["N", "R", "W"],
      routeSummary: "N/R/W to 23 St",
      totalMinutes: 18,
      transferCount: 0,
      walkMinutes: 5
    },
    headers: authHeaders
  });
  expect(commute.ok()).toBe(true);

  const capture = await request.post(`${apiBaseUrl}/api/captures`, {
    data: {
      capturedAt: "2026-04-17T09:00:00.000Z",
      pageText: "Entire rental unit in Chelsea. USD 3200 per month. Studio. Washer in building.",
      selectedText: "Ask whether July 1 through September 12 is available.",
      source: "airbnb",
      thumbnailCandidates: [],
      title: captureTitle,
      url: `https://www.airbnb.com/rooms/e2e-${suffix}`,
      visibleFields: {
        location: "Chelsea",
        price: "USD 3200 month",
        roomType: "Entire rental unit"
      }
    },
    headers: authHeaders
  });
  expect(capture.ok()).toBe(true);

  await page.goto("/");
  await expect(page.getByText("Connected to local API.")).toBeVisible();
  await expect(page.getByText(listingTitle)).toBeVisible();

  await page.route(`${apiBaseUrl}/api/listings/${listingId}/location/geocode`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        listing: geocodedListing,
        location: geocodedLocation,
        status: "ok",
        warnings: []
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.locator("article").filter({ hasText: listingTitle }).getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Geocode" }).click();
  await expect(page.getByText("Saved geocoded coordinates through local API.")).toBeVisible();

  await page.getByRole("button", { name: /Map\/Commute/ }).click();
  await expect(page.getByTestId("pamila-osm-map")).toBeVisible();
  await expect(page.getByText("Listings around Ramp")).toBeVisible();
  await expect(page.getByText(listingTitle)).toBeVisible();

  await page.getByRole("button", { name: /Inbox/ }).click();
  await expect(page.getByText(captureTitle)).toBeVisible();
  await expect(page.getByText("Resolve captured uncertainty")).toBeVisible();
});

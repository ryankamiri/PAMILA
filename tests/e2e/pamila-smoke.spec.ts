import { expect, test } from "@playwright/test";

const apiBaseUrl = "http://localhost:7410";
const onboardingStorageKey = "pamila:onboarding:v1:completed";
const token = "dev-local-token";
const authHeaders = {
  "x-pamila-token": token
};

test("manual listing, map pin, and extension-shaped capture flow", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const listingTitle = `E2E Flatiron studio ${suffix}`;
  const captureTitle = `E2E Chelsea capture ${suffix}`;
  const routeDetail = {
    calculatedAt: "2026-04-17T09:00:00.000Z",
    destinationLabel: "Ramp NYC",
    externalDirectionsUrl: "https://www.google.com/maps/dir/?api=1",
    legs: [
      {
        color: "#6b7280",
        dashArray: "6 6",
        distanceMeters: 450,
        durationMinutes: 5,
        fromName: "Flatiron",
        geometry: [
          [40.7421, -73.9916],
          [40.74205, -73.99154]
        ],
        lineName: null,
        mode: "WALK",
        routeLongName: null,
        style: "walk",
        toName: "Ramp NYC"
      }
    ],
    originLabel: "Flatiron"
  };

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
    commute: {
      ...(locationBody.listing.commute ?? {}),
      hasBusHeavyRoute: false,
      lineNames: ["N", "R", "W"],
      routeDetail,
      routeSummary: "N/R/W to 23 St",
      totalMinutes: 18,
      transferCount: 0,
      walkMinutes: 5
    },
    commuteEstimate: {
      ...(locationBody.listing.commuteEstimate ?? {}),
      hasBusHeavyRoute: false,
      lineNames: ["N", "R", "W"],
      routeDetail,
      routeSummary: "N/R/W to 23 St",
      totalMinutes: 18,
      transferCount: 0,
      walkMinutes: 5
    },
    lastCommuteCheckedAt: "2026-04-17T09:00:00.000Z",
    location: geocodedLocation,
    routeDetail
  };

  const commute = await request.put(`${apiBaseUrl}/api/listings/${listingId}/commute`, {
    data: {
      calculatedAt: "2026-04-17T09:00:00.000Z",
      hasBusHeavyRoute: false,
      lineNames: ["N", "R", "W"],
      routeDetail,
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

  await page.addInitScript((storageKey) => {
    window.localStorage.removeItem(storageKey);
  }, onboardingStorageKey);

  await page.goto("/");
  const onboardingDialog = page.getByRole("dialog");
  await expect(onboardingDialog).toContainText("Welcome to PAMILA");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(onboardingDialog).toBeHidden();
  await expect.poll(
    () => page.evaluate((storageKey) => window.localStorage.getItem(storageKey), onboardingStorageKey)
  ).toBe("true");

  await expect(page.getByText("Connected to local API.")).toBeVisible();
  await expect(page.locator("article").filter({ hasText: listingTitle }).first()).toBeVisible();

  await page.getByRole("button", { name: "How PAMILA Works" }).click();
  await expect(onboardingDialog).toContainText("Welcome to PAMILA");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(onboardingDialog).toContainText("API Status");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(onboardingDialog).toContainText("Daily Queue");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(onboardingDialog).toContainText("Inbox + Manual Add");
  await expect(page.getByRole("heading", { name: "Inbox and Manual Add" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(onboardingDialog).toContainText("Listing Detail");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(onboardingDialog).toContainText("Map/Commute");
  await expect(page.getByRole("heading", { name: "Map and Commute" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(onboardingDialog).toContainText("Shortlist + Panic Mode");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(onboardingDialog).toContainText("Settings + Exports");
  await expect(page.getByRole("heading", { exact: true, name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(onboardingDialog).toContainText("Daily Use Loop");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(onboardingDialog).toBeHidden();
  await page.getByRole("button", { name: /Daily Queue/ }).click();

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
  await page.getByRole("button", { exact: true, name: "Geocode" }).click();
  await expect(page.getByText("Saved geocoded coordinates through local API.")).toBeVisible();

  await page.getByRole("button", { name: /Map\/Commute/ }).click();
  await expect(page.getByTestId("pamila-osm-map")).toBeVisible();
  await expect.poll(() => page.locator(".leaflet-tile").count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator(".pamila-map-marker").count()).toBeGreaterThan(1);
  await expect.poll(() => page.locator(".pamila-route-line").count()).toBeGreaterThan(0);
  await expect(page.getByText("Listings around Ramp")).toBeVisible();
  await expect(page.getByText("Route to Ramp")).toBeVisible();
  await expect(page.getByText("Flatiron to Ramp NYC", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Selected commute route").getByText(listingTitle)).toBeVisible();

  await page.getByRole("button", { name: /Inbox/ }).click();
  await expect(page.getByText(captureTitle)).toBeVisible();
  await expect(page.getByText("Resolve captured uncertainty")).toBeVisible();
});

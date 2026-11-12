import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { describePlacesError, isValidPlaceId, MAX_REVIEWS, normalizePlace, normalizeSearch } from "./places.ts";

Deno.test("normalizePlace keeps the 5 newest reviews and the overall rating", () => {
  const reviews = Array.from({ length: 7 }, (_, i) => ({
    name: `places/x/reviews/${i}`,
    rating: 4,
    text: { text: `r${i}` },
    publishTime: `2026-11-0${i + 1}T00:00:00Z`,
    authorAttribution: { displayName: `A${i}`, uri: "https://maps.google.com/u", photoUri: "javascript:alert(1)" },
  }));
  const out = normalizePlace({ rating: 4.46, userRatingCount: 321, reviews, googleMapsUri: "https://maps.google.com/?cid=1" });
  assertEquals(out.rating, 4.5);
  assertEquals(out.user_rating_count, 321);
  assertEquals(out.reviews.length, MAX_REVIEWS);
  assertEquals(out.reviews[0].text, "r6");
  assertEquals(out.reviews[0].authorPhotoUri, null);
  assertEquals(out.google_maps_uri, "https://maps.google.com/?cid=1");
});

Deno.test("normalizePlace handles an empty place", () => {
  assertEquals(normalizePlace({}), { rating: null, user_rating_count: null, reviews: [], google_maps_uri: null });
});

Deno.test("place IDs cannot change the request path", () => {
  assertEquals(isValidPlaceId("ChIJN1t_tDeuEmsRUsoyG83frY4"), true);
  assertEquals(isValidPlaceId("../places:searchText"), false);
  assertEquals(isValidPlaceId("abc?key=1"), false);
});

Deno.test("errors never echo the response body", () => {
  assertEquals(describePlacesError(403, { error: { status: "PERMISSION_DENIED", message: "API key AIza... invalid" } }), "places_http_403_PERMISSION_DENIED");
});

Deno.test("normalizeSearch drops bad IDs", () => {
  const out = normalizeSearch({ places: [{ id: "bad id" }, { id: "ChIJN1t_tDeuEmsRUsoyG83frY4", displayName: { text: "Coop's" } }] });
  assertEquals(out.length, 1);
  assertEquals(out[0].name, "Coop's");
});

import { easternHour, isRefreshHourEt, needsFullPull } from "./places.ts";

Deno.test("easternHour handles DST", () => {
  assertEquals(easternHour(new Date("2026-07-01T13:17:00Z")), 9); // EDT
  assertEquals(easternHour(new Date("2026-12-01T14:17:00Z")), 9); // EST
  assertEquals(easternHour(new Date("2026-12-01T13:17:00Z")), 8);
});

Deno.test("needsFullPull: count change, empty, stale, or never pulled", () => {
  const now = new Date("2026-11-12T14:00:00Z");
  const base = { storedCount: 100, storedReviews: [{}], lastFullFetchAt: "2026-11-10T14:00:00Z", newCount: 100, now };
  assertEquals(needsFullPull(base), false);
  assertEquals(needsFullPull({ ...base, newCount: 101 }), true);
  assertEquals(needsFullPull({ ...base, storedReviews: [] }), true);
  assertEquals(needsFullPull({ ...base, lastFullFetchAt: null }), true);
  assertEquals(needsFullPull({ ...base, lastFullFetchAt: "2026-11-04T13:00:00Z" }), true);
});

Deno.test("refresh hours are 8 AM through 10 PM Eastern", () => {
  assertEquals([7, 8, 22, 23].map(isRefreshHourEt), [false, true, true, false]);
});

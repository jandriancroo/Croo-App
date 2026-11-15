// Pure helpers for Google Places API (New). No network, no secrets, so they
// can be tested with plain `deno test`.

export const PLACES_BASE = "https://places.googleapis.com/v1";
/** Step 1 on every run: just the score and count (Place Details Pro). */
export const LIGHT_FIELD_MASK = "rating,userRatingCount";
/** Step 2 only when needed: reviews too (Enterprise + Atmosphere). */
export const DETAILS_FIELD_MASK = "id,rating,userRatingCount,reviews,googleMapsUri";
/** Re-pull reviews at least this often so cached Google content stays fresh. */
export const FULL_PULL_MAX_AGE_DAYS = 7;
/** Scheduled runs: hourly, 8 AM through 10 PM Eastern (Georgetown business hours). */
export const REFRESH_FIRST_HOUR_ET = 8;
export const REFRESH_LAST_HOUR_ET = 22;
export const isRefreshHourEt = (hour: number) => hour >= REFRESH_FIRST_HOUR_ET && hour <= REFRESH_LAST_HOUR_ET;
export const SEARCH_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.googleMapsUri";
/** Google returns at most 5; we never keep more. */
export const MAX_REVIEWS = 5;

export interface StoredGoogleReview {
  id: string;
  author: string;
  authorUri: string | null;
  authorPhotoUri: string | null;
  rating: number;
  text: string | null;
  publishTime: string | null;
  relativeTime: string | null;
  googleMapsUri: string | null;
}

export interface StoredGooglePlace {
  rating: number | null;
  user_rating_count: number | null;
  reviews: StoredGoogleReview[];
  google_maps_uri: string | null;
}

/** Read a nested field from untyped Places JSON; every value is checked before use. */
export function pick(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const httpsUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

/** Place Details resource -> the columns we store. Newest first, at most 5. */
export function normalizePlace(place: unknown): StoredGooglePlace {
  const r0 = pick(place, "rating");
  const rating = typeof r0 === "number" && Number.isFinite(r0) ? Math.round(r0 * 10) / 10 : null;
  const c0 = pick(place, "userRatingCount");
  const count = typeof c0 === "number" && Number.isInteger(c0) ? c0 : null;
  const list = pick(place, "reviews");
  const raw: unknown[] = Array.isArray(list) ? list : [];
  const reviews: StoredGoogleReview[] = raw
    .map((r, i): StoredGoogleReview => {
      const rr = pick(r, "rating");
      return {
        id: str(pick(r, "name")) ?? `review-${i}`,
        author: str(pick(r, "authorAttribution", "displayName")) ?? "A Google user",
        authorUri: httpsUrl(pick(r, "authorAttribution", "uri")),
        authorPhotoUri: httpsUrl(pick(r, "authorAttribution", "photoUri")),
        rating: typeof rr === "number" ? Math.max(0, Math.min(5, Math.round(rr))) : 0,
        text: str(pick(r, "text", "text")) ?? str(pick(r, "originalText", "text")),
        publishTime: str(pick(r, "publishTime")),
        relativeTime: str(pick(r, "relativePublishTimeDescription")),
        googleMapsUri: httpsUrl(pick(r, "googleMapsUri")),
      };
    })
    .sort((a, b) => (b.publishTime ?? "").localeCompare(a.publishTime ?? ""))
    .slice(0, MAX_REVIEWS);
  return { rating, user_rating_count: count, reviews, google_maps_uri: httpsUrl(pick(place, "googleMapsUri")) };
}

/** Place IDs are URL-safe tokens; reject anything else so it can't change the request path. */
export function isValidPlaceId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(id);
}

/** Short, key-free error text for last_error and logs. */
export function describePlacesError(status: number, body: unknown): string {
  const s = str(pick(body, "error", "status"));
  return `places_http_${status}${s ? `_${s}` : ""}`.slice(0, 120);
}

export function normalizeSearch(body: unknown): { placeId: string; name: string | null; address: string | null; googleMapsUri: string | null }[] {
  const list = pick(body, "places");
  const places: unknown[] = Array.isArray(list) ? list : [];
  return places
    .filter((p) => isValidPlaceId(pick(p, "id")))
    .slice(0, 5)
    .map((p) => ({
      placeId: pick(p, "id") as string,
      name: str(pick(p, "displayName", "text")),
      address: str(pick(p, "formattedAddress")),
      googleMapsUri: httpsUrl(pick(p, "googleMapsUri")),
    }));
}

/** Hour of day in America/New_York (DST-safe). */
export function easternHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(h);
}

/**
 * After the cheap count check: pull the reviews only when the count moved,
 * nothing is stored yet, or the last full pull is too old (or never happened).
 */
export function needsFullPull(input: {
  storedCount: number | null | undefined;
  storedReviews: unknown;
  lastFullFetchAt: string | null | undefined;
  newCount: number | null | undefined;
  now: Date;
}): boolean {
  if (!Array.isArray(input.storedReviews) || input.storedReviews.length === 0) return true;
  if (!input.lastFullFetchAt) return true;
  const last = Date.parse(input.lastFullFetchAt);
  if (!Number.isFinite(last)) return true;
  if (input.now.getTime() - last > FULL_PULL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return true;
  return (input.newCount ?? null) !== (input.storedCount ?? null);
}

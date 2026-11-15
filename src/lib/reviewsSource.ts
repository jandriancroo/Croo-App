// Which review feed the dashboard pill shows for a store.
// Ovation stores keep Ovation. Stores with an active Google row (and no
// Ovation mapping; the database RPC already enforces that) show Google's
// overall rating and its 5 most recent reviews in the same spot.

export type ReviewsSource = 'ovation' | 'google';

export interface DisplayReview {
  id: string;
  customerName: string;
  rating: number;
  feedback: string | null;
  createdAt: string;
  hasResponse: boolean;
  /** Google only: "2 weeks ago" and the reviewer's Maps profile. */
  relativeTime?: string | null;
  authorUri?: string | null;
}

export interface GoogleReviewsRow {
  location_id: string;
  rating: number | string | null;
  user_rating_count: number | null;
  reviews: unknown;
  google_maps_uri: string | null;
  fetched_at: string | null;
}

/** Ovation wins whenever it has a score; otherwise a Google row; otherwise nothing new. */
export function selectReviewsSource(input: { ovationHasScore: boolean; google: GoogleReviewsRow | null | undefined }): ReviewsSource {
  if (input.ovationHasScore) return 'ovation';
  if (input.google && googleScore(input.google) != null) return 'google';
  return 'ovation';
}

export function googleScore(row: GoogleReviewsRow | null | undefined): number | null {
  if (!row || row.rating == null) return null;
  const n = Number(row.rating);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Stored Google reviews -> the same review shape the Ovation panel renders. */
export function googleDisplayReviews(row: GoogleReviewsRow | null | undefined): DisplayReview[] {
  type Stored = { id?: unknown; author?: unknown; rating?: unknown; text?: unknown; publishTime?: unknown; relativeTime?: unknown; authorUri?: unknown } | null;
  const list: Stored[] = Array.isArray(row?.reviews) ? (row!.reviews as Stored[]) : [];
  return list.slice(0, 5).map((r, i) => ({
    id: typeof r?.id === 'string' ? r.id : `g-${i}`,
    customerName: typeof r?.author === 'string' && r.author.trim() ? (r.author as string) : 'A Google user',
    rating: typeof r?.rating === 'number' ? r.rating : 0,
    feedback: typeof r?.text === 'string' && r.text.trim() ? (r.text as string) : null,
    createdAt: typeof r?.publishTime === 'string' ? r.publishTime : '',
    hasResponse: false,
    relativeTime: typeof r?.relativeTime === 'string' ? r.relativeTime : null,
    authorUri: typeof r?.authorUri === 'string' && (r.authorUri as string).startsWith('https://') ? (r.authorUri as string) : null,
  }));
}

/** Only https Google Maps links are ever rendered. */
export function safeMapsUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

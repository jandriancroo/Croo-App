/** Serialize JSON-LD safely for a <script> tag: escapes "<" so DB text can't close the tag (stored XSS). */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

const DAY_MS = 86_400_000;
const VALID_WINDOW_DAYS = 60;

/**
 * validThrough for a JobPosting.
 * - Real expires_at wins.
 * - Otherwise a rolling 60-day window anchored on posted_at: the end of the
 *   current window (posted + 60·n days, first one in the future). Listings
 *   stay active until a manager closes them; the date keeps rolling forward
 *   and the sitemap/JSON-LD drop the job as soon as status != 'active'.
 */
export function computeValidThrough(postedAt?: string | null, expiresAt?: string | null, now = new Date()): string | undefined {
  if (expiresAt) return new Date(expiresAt).toISOString();
  if (!postedAt) return undefined;
  const posted = new Date(postedAt).getTime();
  if (Number.isNaN(posted)) return undefined;
  const windowMs = VALID_WINDOW_DAYS * DAY_MS;
  const n = Math.max(1, Math.floor((now.getTime() - posted) / windowMs) + 1);
  return new Date(posted + n * windowMs).toISOString();
}

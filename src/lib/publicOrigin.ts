import { SITE_ORIGIN } from '@/lib/jobSeo';

/**
 * Canonical public origin. Anything a user copies, shares or scans must use
 * this, never the Lovable preview / localhost host.
 */
export const PUBLIC_ORIGIN = SITE_ORIGIN;

/**
 * Origin for user-facing links (application links, invite links, QR codes).
 * croohq.com and its subdomains (e.g. kiosk.croohq.com) keep their own host;
 * everywhere else — Lovable preview, localhost — falls back to production so a
 * copied or scanned link never points at the preview gate.
 */
export function getPublicOrigin(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'croohq.com' || host.endsWith('.croohq.com')) {
      return window.location.origin;
    }
  }
  return PUBLIC_ORIGIN;
}

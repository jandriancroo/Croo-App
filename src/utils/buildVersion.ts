/**
 * Build version helpers for the punch clock kiosk.
 *
 * `__APP_VERSION__` is injected at build time (vite.config.ts) in the format
 * YY.MM.DD.HHMM, Pacific. The exact same value is written to /version.json at
 * build time so a sitting kiosk can ask the SERVER whether a newer build is
 * published — the old localStorage comparison could never do that, because it
 * only ever compared the loaded build to itself.
 *
 * IMPORTANT: the version fetch is unauthenticated and never rides the punch
 * clock's Supabase session. A dying auth session must not be able to hang the
 * version check (that is the same class of bug as the frozen clock).
 */

declare const __APP_VERSION__: string;

const LOADED_AT_KEY = 'croohq_build_loaded_at_v1';

export const LOADED_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/**
 * When this device last loaded the running build. Stamped once per version so
 * a stale stamp on the PIN screen is itself the diagnostic that idle-reload
 * never fired.
 */
export function getBuildLoadedAt(): Date | null {
  try {
    const raw = localStorage.getItem(LOADED_AT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === LOADED_VERSION && parsed?.at) return new Date(parsed.at);
    }
    const stamp = { version: LOADED_VERSION, at: new Date().toISOString() };
    localStorage.setItem(LOADED_AT_KEY, JSON.stringify(stamp));
    return new Date(stamp.at);
  } catch {
    return null;
  }
}

/**
 * Ask the server which build is published. Plain fetch, no-store, no auth
 * header, hard timeout. Returns null when unknown (offline, dev, 404) — never
 * throws, never blocks a punch.
 */
export async function fetchServerVersion(timeoutMs = 6000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const body = await res.json();
    const version = typeof body?.version === 'string' ? body.version : null;
    return version || null;
  } catch {
    return null;
  }
}

/** Reload onto the published build, cache-busted (WKWebView re-serves stale HTML otherwise). */
export function reloadToVersion(version: string) {
  try {
    localStorage.setItem('app-version', version);
    localStorage.removeItem(LOADED_AT_KEY);
  } catch {}
  const url = new URL(window.location.href);
  url.searchParams.set('v', version);
  window.location.replace(url.toString());
}

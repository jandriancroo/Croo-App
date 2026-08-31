/**
 * Punch clock device pairing — client-side credential management.
 *
 * A "paired device" is a tablet that has redeemed a pairing code and now has
 * its own dedicated Supabase auth session. That session is the ONLY session
 * that should ever be alive on the tablet when the punch clock is displayed
 * — that's what prevents force-quit from dropping staff into a manager's
 * account.
 *
 * Storage strategy: localStorage + cookie backup (belt & suspenders).
 * iOS Safari can evict localStorage after ~7 days of no interaction; the
 * cookie is a 400-day-long fallback so a tablet that goes quiet over a
 * holiday closure doesn't wake up unpaired.
 */

import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'croohq_punch_device_v1';
const COOKIE_NAME = 'croohq_punch_device_v1';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // ~400 days (browser cap)
// Session-scoped flag that, when set, tells the app "an admin just exited
// kiosk mode — DON'T auto-restore the device session on this tab". Cleared
// automatically when the tab closes (force-quit → cleared → next launch
// goes straight back to punch clock, which is what we want).
const EXIT_FLAG = 'croohq_kiosk_exit_active_v1';

function getSupabaseAuthStorageKeys(): string[] {
  const keys = new Set<string>();

  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const ref = url ? new URL(url).hostname.split('.')[0] : null;
    if (ref) keys.add(`sb-${ref}-auth-token`);
  } catch {}

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
        keys.add(key);
      }
    }
  } catch {}

  return [...keys];
}

function clearActiveAuthSessionLocalOnly() {
  for (const key of getSupabaseAuthStorageKeys()) {
    try { localStorage.removeItem(key); } catch {}
  }
}

export interface PunchDeviceLocation {
  id: string;
  name: string;
  store_number?: string | null;
  organization_id?: string;
}

export interface PunchDeviceCredential {
  deviceId: string;
  deviceName: string;
  location: PunchDeviceLocation;
  session: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
  };
}

// ---------------------------------------------------------------- cookies

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
  } catch {}
}

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function deleteCookie(name: string) {
  try {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  } catch {}
}

// ---------------------------------------------------------------- storage

export function getPairing(): PunchDeviceCredential | null {
  // localStorage first (fast path)
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.deviceId && parsed?.session?.refresh_token) return parsed;
    }
  } catch {}
  // Cookie fallback (iOS 7-day eviction survivor)
  const cookie = readCookie(COOKIE_NAME);
  if (cookie) {
    try {
      const parsed = JSON.parse(cookie);
      if (parsed?.deviceId && parsed?.session?.refresh_token) {
        // Rehydrate localStorage from cookie
        try { localStorage.setItem(STORAGE_KEY, cookie); } catch {}
        return parsed;
      }
    } catch {}
  }
  return null;
}

export function setPairing(cred: PunchDeviceCredential) {
  const raw = JSON.stringify(cred);
  try { localStorage.setItem(STORAGE_KEY, raw); } catch {}
  setCookie(COOKIE_NAME, raw, COOKIE_MAX_AGE_SECONDS);
}

export function updateStoredSession(session: { access_token: string; refresh_token: string; expires_at?: number }) {
  const cred = getPairing();
  if (!cred) return;
  cred.session = session;
  setPairing(cred);
}

export function clearPairing() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  deleteCookie(COOKIE_NAME);
}

export function isPaired(): boolean {
  return !!getPairing();
}

export function isPunchDeviceUser(user: { user_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.user_metadata?.is_punch_device === true;
}

// ---------------------------------------------------------------- exit flag

// The exit flag now survives a tablet restart / PWA relaunch for a limited
// window (30 minutes). Android kills sessionStorage when the PWA is swiped
// away, which used to make the tablet auto-restore kiosk mode and sign a
// manager out mid-login. localStorage + timestamp fixes that, and the TTL
// guarantees the tablet still returns to the punch clock on its own.
const EXIT_UNTIL_KEY = 'croohq_kiosk_exit_until_v1';
const EXIT_TTL_MS = 30 * 60 * 1000;

export function isKioskExitActive(): boolean {
  try {
    if (sessionStorage.getItem(EXIT_FLAG) === '1') return true;
  } catch {}
  try {
    const until = Number(localStorage.getItem(EXIT_UNTIL_KEY) || 0);
    if (until && Date.now() < until) return true;
    if (until) localStorage.removeItem(EXIT_UNTIL_KEY);
  } catch {}
  return false;
}
export function setKioskExitActive() {
  try { sessionStorage.setItem(EXIT_FLAG, '1'); } catch {}
  try { localStorage.setItem(EXIT_UNTIL_KEY, String(Date.now() + EXIT_TTL_MS)); } catch {}
}
export function clearKioskExitActive() {
  try { sessionStorage.removeItem(EXIT_FLAG); } catch {}
  try { localStorage.removeItem(EXIT_UNTIL_KEY); } catch {}
}

// ------------------------------------------------------- broken pairing flag

// Set when a stored device session can no longer be restored (refresh token
// rotated away / revoked). While set, auto-restore stops trying so a manager
// can actually reach the login screen, and the pairing screen tells them the
// tablet needs a fresh pairing code.
const PAIRING_BROKEN_KEY = 'croohq_punch_device_broken_v1';

export function isPairingBroken(): boolean {
  try { return localStorage.getItem(PAIRING_BROKEN_KEY) === '1'; } catch { return false; }
}
export function markPairingBroken() {
  try { localStorage.setItem(PAIRING_BROKEN_KEY, '1'); } catch {}
}
export function clearPairingBroken() {
  try { localStorage.removeItem(PAIRING_BROKEN_KEY); } catch {}
}


// ---------------------------------------------------------------- flow

/**
 * Enter kiosk mode: sign out any active human session, restore the device
 * session from stored credentials. Caller navigates to /punch-clock after.
 * Returns true on success, false if not paired or restore failed.
 */
let enterKioskModePromise: Promise<boolean> | null = null;

export async function enterKioskMode(): Promise<boolean> {
  if (enterKioskModePromise) return enterKioskModePromise;

  enterKioskModePromise = enterKioskModeOnce().finally(() => {
    enterKioskModePromise = null;
  });

  return enterKioskModePromise;
}

async function enterKioskModeOnce(): Promise<boolean> {
  const cred = getPairing();
  if (!cred) return false;

  // Clear the "just exited" flag — we're actively re-entering.
  clearKioskExitActive();

  // If the tablet is already signed in as the paired device, do not sign out
  // and re-consume the same refresh token. This prevents double entry paths
  // (login-screen click + auto-restore) from immediately killing the kiosk
  // session and bouncing the tablet back to login.
  const existing = await supabase.auth.getSession().catch(() => null);
  const existingSession = existing?.data?.session;
  if (existingSession && isPunchDeviceUser(existingSession.user)) {
    updateStoredSession({
      access_token: existingSession.access_token,
      refresh_token: existingSession.refresh_token,
      expires_at: existingSession.expires_at,
    });
    clearPairingBroken();
    return true;
  }

  // Hard sign-out of whatever session is currently on the device.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});

  // Restore the device session.
  const { data, error } = await supabase.auth.setSession({
    access_token: cred.session.access_token,
    refresh_token: cred.session.refresh_token,
  });

  if (error || !data.session) {
    console.error('[punchDevicePairing] Failed to restore device session:', error);
    // Stored token is no longer usable. Stop auto-restore loops so a manager
    // can reach the login screen and re-pair the tablet.
    markPairingBroken();
    return false;
  }

  // Persist any refreshed tokens back to our own storage.
  updateStoredSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
  clearPairingBroken();

  return true;
}

/**
 * Keep the paired device session fresh. Called when the punch clock becomes
 * visible again (tablet wake, PWA foreground). A stale/expired access token is
 * the classic "scheduled staff can't punch in" failure: reads and writes start
 * failing on RLS while the UI still looks paired. Refreshing on wake, and
 * persisting the rotated refresh token, prevents that drift.
 */
export async function refreshDeviceSession(): Promise<boolean> {
  if (!getPairing()) return false;
  const { data, error } = await supabase.auth.refreshSession();
  const session = data?.session;
  if (error || !session) {
    // Fall back to re-establishing from stored credentials.
    return enterKioskMode();
  }
  if (!isPunchDeviceUser(session.user)) return false;
  updateStoredSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  });
  clearPairingBroken();
  return true;
}

/**
 * Exit kiosk mode: sign out the device session so the tablet is available
 * for other work. Pairing credentials remain in localStorage + cookie so
 * the next launch (or the next Time > Punch Clock tap) re-enters kiosk mode.
 */
export async function exitKioskMode() {
  setKioskExitActive();

  // Do NOT call auth.signOut() here. Even with local scope, the hosted auth
  // server can revoke the refresh token that we need to restore the paired
  // device later. Exit is only a UI escape to the login screen, so preserve the
  // latest paired-device token, then remove only the active auth session from
  // browser storage.
  const existing = await supabase.auth.getSession().catch(() => null);
  const existingSession = existing?.data?.session;
  if (existingSession && isPunchDeviceUser(existingSession.user)) {
    updateStoredSession({
      access_token: existingSession.access_token,
      refresh_token: existingSession.refresh_token,
      expires_at: existingSession.expires_at,
    });
  }

  try { supabase.auth.stopAutoRefresh(); } catch {}
  clearActiveAuthSessionLocalOnly();
}

/**
 * Redeem a pairing code with the backend and store the resulting device
 * credentials. Does NOT establish the session automatically — call
 * enterKioskMode() after this to actually sign in as the device.
 */
export async function redeemPairingCode(code: string): Promise<PunchDeviceCredential> {
  const { data, error } = await supabase.functions.invoke('punch-device-service', {
    body: { action: 'redeem', code },
  });
  if (error) throw new Error(error.message || 'Failed to redeem code');
  if (data?.error) throw new Error(data.error);
  if (!data?.deviceId || !data?.session) throw new Error('Invalid response from pairing service');

  const cred: PunchDeviceCredential = {
    deviceId: data.deviceId,
    deviceName: data.deviceName,
    location: data.location,
    session: data.session,
  };
  setPairing(cred);
  clearPairingBroken();
  clearKioskExitActive();
  return cred;
}

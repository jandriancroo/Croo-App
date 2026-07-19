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

// ---------------------------------------------------------------- exit flag

export function isKioskExitActive(): boolean {
  try { return sessionStorage.getItem(EXIT_FLAG) === '1'; } catch { return false; }
}
export function setKioskExitActive() {
  try { sessionStorage.setItem(EXIT_FLAG, '1'); } catch {}
}
export function clearKioskExitActive() {
  try { sessionStorage.removeItem(EXIT_FLAG); } catch {}
}

// ---------------------------------------------------------------- flow

/**
 * Enter kiosk mode: sign out any active human session, restore the device
 * session from stored credentials. Caller navigates to /punch-clock after.
 * Returns true on success, false if not paired or restore failed.
 */
export async function enterKioskMode(): Promise<boolean> {
  const cred = getPairing();
  if (!cred) return false;

  // Clear the "just exited" flag — we're actively re-entering.
  clearKioskExitActive();

  // Hard sign-out of whatever session is currently on the device.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});

  // Restore the device session.
  const { data, error } = await supabase.auth.setSession({
    access_token: cred.session.access_token,
    refresh_token: cred.session.refresh_token,
  });

  if (error || !data.session) {
    console.error('[punchDevicePairing] Failed to restore device session:', error);
    return false;
  }

  // Persist any refreshed tokens back to our own storage.
  updateStoredSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });

  return true;
}

/**
 * Exit kiosk mode: sign out the device session so the tablet is available
 * for other work. Pairing credentials remain in localStorage + cookie so
 * the next launch (or the next Time > Punch Clock tap) re-enters kiosk mode.
 */
export async function exitKioskMode() {
  setKioskExitActive();
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
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
  return cred;
}

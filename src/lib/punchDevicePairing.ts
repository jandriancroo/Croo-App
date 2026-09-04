/**
 * Punch clock device pairing — client-side credential management.
 *
 * A "paired device" is a tablet that has redeemed a pairing code and now has
 * its own dedicated Supabase auth session. That session is the ONLY session
 * that should ever be alive on the tablet when the punch clock is displayed
 * — that's what prevents force-quit from dropping staff into a manager's
 * account.
 *
 * PAIRING MODEL (locked 2026-09-03 — "pairing until revoke"):
 *   - The durable credential is the DEVICE SECRET, minted once at redeem and
 *     stored hashed on the device row. It never rotates.
 *   - Auth sessions are disposable. If a refresh token is stale, spent, or the
 *     tablet was force-quit mid-rotation, we call `reissue` with the secret and
 *     get a brand-new session for the SAME device row / SAME auth user.
 *   - A tablet is only "dead" (needs a new pairing code) when the SERVER says
 *     the device row is missing or revoked. Nothing else unpairs it. There is
 *     no TTL on a live device, and `last_active_at` is telemetry only.
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
  /** Durable proof of possession. Does not rotate. */
  deviceSecret?: string;
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

// A stored pairing is valid if it can prove itself EITHER way: a durable
// secret (preferred) or a refresh token (legacy tablets, pre-secret).
function isUsablePairing(parsed: any): boolean {
  return !!parsed?.deviceId && (!!parsed?.deviceSecret || !!parsed?.session?.refresh_token);
}

export function getPairing(): PunchDeviceCredential | null {
  // localStorage first (fast path)
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isUsablePairing(parsed)) return parsed;
    }
  } catch {}
  // Cookie fallback (iOS 7-day eviction survivor)
  const cookie = readCookie(COOKIE_NAME);
  if (cookie) {
    try {
      const parsed = JSON.parse(cookie);
      if (isUsablePairing(parsed)) {
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

export function storeDeviceSecret(deviceSecret: string) {
  const cred = getPairing();
  if (!cred || !deviceSecret) return;
  cred.deviceSecret = deviceSecret;
  setPairing(cred);
}

export function hasDeviceSecret(): boolean {
  return !!getPairing()?.deviceSecret;
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

// --------------------------------------------------------- dead pairing flag

// Set ONLY when the server tells us the device row is gone or revoked. A failed
// token restore is no longer terminal — reissue handles that. This flag exists
// so a revoked tablet stops looping and a manager can sign in and re-pair.
const PAIRING_DEAD_KEY = 'croohq_punch_device_broken_v1';

export function isPairingDead(): boolean {
  try { return localStorage.getItem(PAIRING_DEAD_KEY) === '1'; } catch { return false; }
}
export function markPairingDead() {
  try { localStorage.setItem(PAIRING_DEAD_KEY, '1'); } catch {}
}
export function clearPairingDead() {
  try { localStorage.removeItem(PAIRING_DEAD_KEY); } catch {}
}

/** @deprecated name kept for existing call sites — same meaning as isPairingDead(). */
export const isPairingBroken = isPairingDead;
export const clearPairingBroken = clearPairingDead;

// ------------------------------------------------------- ONE single-flight lock

/**
 * A single named lock shared by EVERY pairing-touching trigger:
 * boot restore, wake repair, secret backfill and the idle build reload.
 * If any one holds it, the others defer instead of racing for the same
 * refresh token (which is single-use and was the original freeze).
 */
export type PairingTask = 'boot-restore' | 'wake-repair' | 'secret-backfill' | 'idle-reload' | 'punch-repair';

export const PAIRING_DEFERRED = Symbol('pairing-deferred');

let lockHolder: PairingTask | null = null;
let lockPromise: Promise<any> | null = null;

export function isPairingLockBusy(): boolean {
  return lockHolder !== null;
}
export function pairingLockHolder(): PairingTask | null {
  return lockHolder;
}

export async function withPairingLock<T>(
  task: PairingTask,
  fn: () => Promise<T>,
): Promise<T | typeof PAIRING_DEFERRED> {
  if (lockHolder) {
    // Same concern already running → join it. Different concern → defer.
    if (lockHolder === task && lockPromise) return lockPromise as Promise<T>;
    return PAIRING_DEFERRED;
  }
  lockHolder = task;
  lockPromise = (async () => fn())().finally(() => {
    lockHolder = null;
    lockPromise = null;
  });
  return lockPromise as Promise<T>;
}

// ---------------------------------------------------------------- flow

function applySession(session: { access_token: string; refresh_token: string; expires_at?: number }) {
  updateStoredSession(session);
}

/**
 * Reissue: the PRIMARY restore path. Proves possession with deviceId + secret,
 * gets a brand-new session for the same device row, and installs it.
 * Returns true on success. Marks pairing dead only if the server says the
 * device is missing or revoked.
 */
async function reissueOnce(): Promise<boolean> {
  const cred = getPairing();
  if (!cred?.deviceSecret) return false;

  const { data, error } = await supabase.functions.invoke('punch-device-service', {
    body: { action: 'reissue', deviceId: cred.deviceId, deviceSecret: cred.deviceSecret },
  });

  if (data?.dead === true) {
    console.warn('[punchDevicePairing] device is revoked or missing — pairing is dead');
    markPairingDead();
    return false;
  }
  if (error || !data?.session?.refresh_token) {
    console.warn('[punchDevicePairing] reissue failed (retryable):', error?.message || data?.error);
    return false;
  }

  // Install the NEW session FIRST. Never sign out before we have a working
  // replacement — a gap with no auth is exactly what let a boot race decide the
  // tablet was signed out and push it to /auth.
  const { data: set, error: setErr } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (setErr || !set.session) {
    console.warn('[punchDevicePairing] reissued session could not be installed:', setErr?.message);
    return false;
  }


  const next: PunchDeviceCredential = {
    ...cred,
    deviceName: data.deviceName || cred.deviceName,
    location: data.location || cred.location,
    session: {
      access_token: set.session.access_token,
      refresh_token: set.session.refresh_token,
      expires_at: set.session.expires_at,
    },
  };
  setPairing(next);
  clearPairingDead();
  return true;
}

/** Public reissue — always runs under the shared lock. */
export async function reissueDeviceSession(task: PairingTask = 'wake-repair'): Promise<boolean> {
  const result = await withPairingLock(task, reissueOnce);
  return result === PAIRING_DEFERRED ? false : result;
}

/**
 * Legacy tablets (paired before durable secrets) that still hold a working
 * device session mint their secret in the background. No new pairing code.
 */
async function backfillSecretOnce(): Promise<boolean> {
  const cred = getPairing();
  if (!cred || cred.deviceSecret) return false;

  const { data: sess } = await supabase.auth.getSession().catch(() => ({ data: { session: null } } as any));
  if (!sess?.session || !isPunchDeviceUser(sess.session.user)) return false;

  const { data, error } = await supabase.functions.invoke('punch-device-service', {
    body: { action: 'backfill_secret' },
  });
  if (data?.dead === true) {
    markPairingDead();
    return false;
  }
  if (error || !data?.deviceSecret) return false;

  storeDeviceSecret(data.deviceSecret);
  console.log('[punchDevicePairing] device key stored — this tablet will self-recover from now on');
  return true;
}

export async function ensureDeviceSecret(): Promise<boolean> {
  const result = await withPairingLock('secret-backfill', backfillSecretOnce);
  return result === PAIRING_DEFERRED ? false : result;
}

/**
 * Enter kiosk mode: make sure the tablet is signed in as its paired device.
 * Order of operations:
 *   1. Already the device session → keep it (never re-consume a refresh token).
 *   2. Reissue with the durable secret (primary).
 *   3. Legacy fallback: restore the stored refresh token, then backfill a secret.
 * Caller navigates to /punch-clock after. Returns true on success.
 */
export async function enterKioskMode(task: PairingTask = 'boot-restore'): Promise<boolean> {
  const result = await withPairingLock(task, enterKioskModeOnce);
  return result === PAIRING_DEFERRED ? false : result;
}

async function enterKioskModeOnce(): Promise<boolean> {
  const cred = getPairing();
  if (!cred) return false;

  // Clear the "just exited" flag — we're actively re-entering.
  clearKioskExitActive();

  // If the tablet is already signed in as the paired device, do not sign out
  // and re-consume the same refresh token.
  const existing = await supabase.auth.getSession().catch(() => null);
  const existingSession = existing?.data?.session;
  if (existingSession && isPunchDeviceUser(existingSession.user)) {
    applySession({
      access_token: existingSession.access_token,
      refresh_token: existingSession.refresh_token,
      expires_at: existingSession.expires_at,
    });
    clearPairingDead();
    if (!cred.deviceSecret) backfillSecretOnce().catch(() => {});
    return true;
  }

  // PRIMARY: durable secret → brand-new session, same device.
  if (cred.deviceSecret) {
    const ok = await reissueOnce();
    if (ok) return true;
    if (isPairingDead()) return false;
    // fall through to the stored token as a second chance
  }

  // LEGACY / fallback: restore from the stored refresh token. setSession replaces
  // whatever session is installed, so we never sign out first (no auth gap).
  if (cred.session?.refresh_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: cred.session.access_token,
      refresh_token: cred.session.refresh_token,
    });

    if (!error && data.session) {
      applySession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      });
      clearPairingDead();
      if (!cred.deviceSecret) backfillSecretOnce().catch(() => {});
      return true;
    }
    console.warn('[punchDevicePairing] stored token restore failed:', error?.message);
  }

  // Not dead — just unrecoverable right now (offline, transient 5xx). The next
  // wake/visibility trigger tries again. Only the server can declare it dead.
  return false;
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
    applySession({
      access_token: existingSession.access_token,
      refresh_token: existingSession.refresh_token,
      expires_at: existingSession.expires_at,
    });
  }

  try { supabase.auth.stopAutoRefresh(); } catch {}
  clearActiveAuthSessionLocalOnly();
}

/**
 * Keep the paired device session fresh. Called when the punch clock becomes
 * visible again (tablet wake, PWA foreground). A stale/expired access token is
 * the classic "scheduled staff can't punch in" failure. Bounded so a hung
 * refresh can never leave the kiosk spinning forever.
 */
export async function refreshDeviceSession(): Promise<boolean> {
  if (!getPairing()) return false;

  const result = await withPairingLock('wake-repair', async () => {
    const refreshed = await withTimeout(supabase.auth.refreshSession(), 8000).catch(() => null);
    const session = refreshed?.data?.session;
    if (session && isPunchDeviceUser(session.user)) {
      applySession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      });
      clearPairingDead();
      const cred = getPairing();
      if (cred && !cred.deviceSecret) backfillSecretOnce().catch(() => {});
      return true;
    }
    // Refresh hung or the token was already spent → reissue with the secret.
    return enterKioskModeOnce();
  });

  return result === PAIRING_DEFERRED ? false : result;
}

/**
 * In-session repair. Called when a punch write or heartbeat fails with an auth
 * error mid-shift (the "clock froze" symptom). Renews the session so the caller
 * can retry the action exactly once.
 */
export async function repairDeviceSession(): Promise<boolean> {
  if (!getPairing()) return false;
  const result = await withPairingLock('punch-repair', async () => {
    const cred = getPairing();
    if (cred?.deviceSecret) {
      const ok = await reissueOnce();
      if (ok) return true;
      if (isPairingDead()) return false;
    }
    return enterKioskModeOnce();
  });
  return result === PAIRING_DEFERRED ? false : result;
}

/** Telemetry only. Never used to expire a device. */
export async function sendDeviceHeartbeat(): Promise<void> {
  if (!getPairing()) return;
  try {
    await supabase.functions.invoke('punch-device-service', { body: { action: 'heartbeat' } });
  } catch {
    // Heartbeat is best-effort; never surface to the floor.
  }
}

/** Reject after `ms` so no kiosk action can hang forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => { window.clearTimeout(id); resolve(v); },
      (e) => { window.clearTimeout(id); reject(e); },
    );
  });
}

/**
 * Redeem a pairing code with the backend and store the resulting device
 * credentials (including the durable device secret). Does NOT establish the
 * session automatically — call enterKioskMode() after this.
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
    deviceSecret: data.deviceSecret,
    location: data.location,
    session: data.session,
  };
  setPairing(cred);
  clearPairingDead();
  clearKioskExitActive();
  return cred;
}

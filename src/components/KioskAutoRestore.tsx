/**
 * Auto-restore paired-device kiosk mode.
 *
 * Runs at app root. On cold launch of a paired tablet, ensures the app
 * signs out any lingering human session, restores the device session, and
 * navigates to /punch-clock — so force-quitting and reopening always lands
 * on the punch clock, never on a login screen or a manager's dashboard.
 *
 * Suppressed while the sessionStorage exit flag is set (an admin has
 * explicitly exited kiosk mode to use the tablet for other work). That
 * flag lives only for the current tab, so a force-quit clears it.
 */
import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import {
  isPaired,
  isKioskExitActive,
  isPairingDead,
  enterKioskMode,
  getPairing,
  updateStoredSession,
  isPunchDeviceUser,
  ensureDeviceSecret,
  isPairingLockBusy,
} from '@/lib/punchDevicePairing';

export const KioskAutoRestore = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (inFlightRef.current) return;
    if (!isPaired()) return;
    // Pairing is only dead when the server said the device row is gone or
    // revoked. A failed token restore is retryable (reissue handles it), so we
    // no longer bail out on a one-off failure.
    if (isPairingDead()) return;


    const path = location.pathname;
    const isDeviceSession = isPunchDeviceUser(user);

    // Case A: user explicitly navigated to /punch-clock but isn't the device
    // session yet → sign out current user, restore device session. Ignore
    // the "just exited" flag here because tapping Punch Clock is an explicit
    // request to re-enter kiosk mode.
    const explicitPunchClock = path === '/punch-clock' && !isDeviceSession;

    // Case B: cold launch with NO signed-in human and no exit flag → restore
    // kiosk so force-quit + reopen always returns to the punch clock. Never
    // yank a manager who is signed in or actively on the login screen.
    const coldRestore =
      !isKioskExitActive() && !isDeviceSession && !user && path !== '/punch-clock';

    if (!explicitPunchClock && !coldRestore) return;
    if (!getPairing()) return;


    inFlightRef.current = true;
    (async () => {
      const ok = await enterKioskMode();
      if (ok) {
        navigate('/punch-clock', { replace: true });
      }
      inFlightRef.current = false;
    })();
  }, [loading, user?.id, location.pathname, navigate]);

  // Mirror rotated refresh tokens back into our own storage so a subsequent
  // cold launch can always restore the device session. Supabase rotates the
  // refresh token on every refresh; if we don't capture the new one, the
  // stored copy becomes stale and enterKioskMode() fails with "Could not
  // restore paired session."
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) return;
      if (event !== 'TOKEN_REFRESHED' && event !== 'SIGNED_IN') return;
      const isDeviceSession = isPunchDeviceUser(session.user);
      if (!isDeviceSession) return;
      if (!isPaired()) return;
      updateStoredSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Daily self-heal: paired kiosk tablets that stay open for days accumulate
  // stale JS, stale query caches and stale auth state. Once per day, in the
  // pre-open window (4:00–5:59 AM local), reload the page so the tablet starts
  // every business day on fresh code and fresh data.
  //
  // Guards (never interrupt a human mid-punch):
  //   - only on paired devices
  //   - only while sitting on /punch-clock
  //   - only if no touch/click/keypress in the last 3 minutes
  // Purely a page reload — no punch clock logic, UI or access rules change.
  useEffect(() => {
    if (!isPaired()) return;

    const LAST_KEY = 'croohq_kiosk_daily_reload_v1';
    let lastInteraction = Date.now();
    const touch = () => { lastInteraction = Date.now(); };
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((e) => document.addEventListener(e, touch, { passive: true }));

    const tick = () => {
      const now = new Date();
      const hour = now.getHours();
      if (hour < 4 || hour >= 6) return;
      if (window.location.pathname !== '/punch-clock') return;
      if (Date.now() - lastInteraction < 3 * 60 * 1000) return;

      const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_KEY); } catch {}
      if (last === today) return;
      try { localStorage.setItem(LAST_KEY, today); } catch {}

      console.log('[KioskAutoRestore] Daily pre-open refresh — reloading tablet.');
      window.location.reload();
    };

    const id = window.setInterval(tick, 60 * 1000);
    tick();
    return () => {
      window.clearInterval(id);
      events.forEach((e) => document.removeEventListener(e, touch));
    };
  }, []);

  return null;
};


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
  enterKioskMode,
  getPairing,
  updateStoredSession,
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

    const path = location.pathname;
    const isDeviceSession = (user?.user_metadata as any)?.is_punch_device === true;

    // Case A: user explicitly navigated to /punch-clock but isn't the device
    // session yet → sign out current user, restore device session. Ignore
    // the "just exited" flag here because tapping Punch Clock is an explicit
    // request to re-enter kiosk mode.
    const explicitPunchClock = path === '/punch-clock' && !isDeviceSession;

    // Case B: cold launch (no explicit exit flag) and not already in kiosk →
    // auto-restore so force-quit + reopen always returns to kiosk.
    const coldRestore = !isKioskExitActive() && !isDeviceSession && path !== '/punch-clock';

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

  return null;
};

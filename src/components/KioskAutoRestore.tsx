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
import {
  isPaired,
  isKioskExitActive,
  enterKioskMode,
  getPairing,
} from '@/lib/punchDevicePairing';

export const KioskAutoRestore = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (attemptedRef.current) return;
    if (!isPaired()) return;
    if (isKioskExitActive()) return;

    // Don't fight explicit routes that make sense to stay on
    const path = location.pathname;
    const currentIsPunchClock = path === '/punch-clock';

    const pairing = getPairing();
    if (!pairing) return;

    // If we're already the device session AND already on /punch-clock, nothing to do.
    const isDeviceSession = (user?.user_metadata as any)?.is_punch_device === true;
    if (isDeviceSession && currentIsPunchClock) {
      attemptedRef.current = true;
      return;
    }

    attemptedRef.current = true;
    (async () => {
      const ok = await enterKioskMode();
      if (ok) {
        navigate('/punch-clock', { replace: true });
      }
    })();
  }, [loading, user?.id, location.pathname, navigate]);

  return null;
};

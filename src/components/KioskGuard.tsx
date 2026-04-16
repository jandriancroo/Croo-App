import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export const KIOSK_LOCATION_KEY = 'croohq_kiosk_location';

/**
 * Global kiosk lock. When localStorage has a kiosk location, redirect every
 * route to /kiosk. The only allowed route is /kiosk itself. This survives
 * force-quit, reboot, and PWA reloads because localStorage persists.
 *
 * Auth routes (/auth, /reset-password, /forgot-password) are explicitly
 * blocked so a user can't sign in as themselves to escape the kiosk.
 */
export const KioskGuard = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const isKioskLocked = !!localStorage.getItem(KIOSK_LOCATION_KEY);
    if (isKioskLocked && location.pathname !== '/kiosk') {
      navigate('/kiosk', { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
};

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { emitAppResume } from '@/lib/appResume';
import { isSafeInAppPath } from '@/lib/pushRouting';

// Web/PWA: the service worker posts CROO_PUSH_NAVIGATE after a notification tap.
export function PushNavigationHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = location.pathname + location.search;

  useEffect(() => {
    if (Capacitor.isNativePlatform() || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || msg.type !== 'CROO_PUSH_NAVIGATE') return;
      if (isSafeInAppPath(msg.url) && msg.url !== window.location.pathname + window.location.search) {
        navigate(msg.url);
      }
      // Let the new screen mount, then refresh chat/feed.
      setTimeout(() => emitAppResume(), 0);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate, current]);

  return null;
}

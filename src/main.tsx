import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { syncChromeColor } from "./utils/syncChrome";
import { debugWatchLog } from "./utils/debugWatch";

// Initialize theme and text size from localStorage before React renders to prevent flash
const THEME_MIGRATION: Record<string, string> = { ocean: 'beach', sage: 'beach', lavender: 'default', vibrant: 'default' };
let savedTheme = localStorage.getItem('app-theme') || 'default';
if (THEME_MIGRATION[savedTheme]) {
  savedTheme = THEME_MIGRATION[savedTheme];
  localStorage.setItem('app-theme', savedTheme);
}
document.documentElement.setAttribute('data-theme', savedTheme);
syncChromeColor();

const savedTextSize = localStorage.getItem('app-text-size') || 'default';
document.documentElement.setAttribute('data-text-size', savedTextSize);




// Mark standalone mode on html element for CSS targeting (iOS fallback)
const isStandaloneMode =
  window.matchMedia?.('(display-mode: standalone)')?.matches ||
  (window.navigator as any).standalone === true;
if (isStandaloneMode) {
  document.documentElement.setAttribute('data-standalone', 'true');
}

// Service worker management: unregister any stale SWs (from previous iterations
// that intercepted auth/token requests), then register our push-only SW so that
// push notifications can subscribe. The push SW only handles push/notificationclick
// events — it does NOT cache HTML or app-shell requests, so it cannot cause the
// "Load failed" stale-cache bug that the old cleanup was guarding against.
const PUSH_SW_URL = '/sw-push.js';

// Native (Capacitor) shells load from capacitor://localhost where service workers
// and version-based location.replace() reloads are unsupported and can leave the
// webview on a blank screen. Detect and skip both paths there.
const isNativeShell =
  typeof window !== 'undefined' &&
  (((window as any).Capacitor?.isNativePlatform?.() ?? false) ||
    !/^https?:$/.test(window.location.protocol));

const setupServiceWorkers = async () => {
  if (isNativeShell) return;
  if (!('serviceWorker' in navigator)) return;


  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    // Unregister any SW that is NOT our push handler (cleans up stale ones)
    const stale = registrations.filter(
      (r) => !r.active?.scriptURL?.endsWith(PUSH_SW_URL) &&
             !r.installing?.scriptURL?.endsWith(PUSH_SW_URL) &&
             !r.waiting?.scriptURL?.endsWith(PUSH_SW_URL)
    );

    if (stale.length) {
      console.warn(`[SW] Removing ${stale.length} stale service worker registration(s)`);
      await Promise.all(stale.map((r) => r.unregister()));

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }

      const reloadKey = 'sw_cleanup_reload_attempted';
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, 'true');
        window.location.reload();
        return;
      }
    }

    // Register the push SW so usePushNotifications can subscribe
    const hasPushSw = registrations.some(
      (r) => r.active?.scriptURL?.endsWith(PUSH_SW_URL) ||
             r.installing?.scriptURL?.endsWith(PUSH_SW_URL) ||
             r.waiting?.scriptURL?.endsWith(PUSH_SW_URL)
    );
    if (!hasPushSw) {
      console.log('[SW] Registering push service worker');
      await navigator.serviceWorker.register(PUSH_SW_URL, { scope: '/' });
    }
  } catch (error) {
    console.warn('[SW] Setup failed', error);
  }
};

setupServiceWorkers();


// Force-refresh when a new published version is detected (prevents stale Safari/PWA caches).
// __APP_VERSION__ is injected at build time in vite.config.ts.
declare const __APP_VERSION__: string;

// Helper: defer any reload while an inventory count session is in progress.
// Without this, an auto-update mid-count silently wipes unsaved data.
const isInventoryCountActive = (): boolean => {
  try {
    return (window as any).__INVENTORY_COUNT_LOCK__?.active === true;
  } catch {
    return false;
  }
};

const performDeferrableReload = (doReload: () => void) => {
  if (!isInventoryCountActive()) {
    doReload();
    return;
  }
  console.log("[Main] Reload deferred — inventory count in progress");
  // Poll: as soon as the count session ends, perform the reload.
  const poll = window.setInterval(() => {
    if (!isInventoryCountActive()) {
      window.clearInterval(poll);
      doReload();
    }
  }, 1000);
};

try {
  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined;
  if (currentVersion && !isNativeShell) {

    const storedVersion = localStorage.getItem('app-version');
    if (storedVersion && storedVersion !== currentVersion) {
      localStorage.setItem('app-version', currentVersion);
      const url = new URL(window.location.href);
      url.searchParams.set('v', currentVersion);
      performDeferrableReload(() => window.location.replace(url.toString()));
    } else if (!storedVersion) {
      localStorage.setItem('app-version', currentVersion);
    }
  }
} catch {
  // ignore
}

// Catch stale Vite chunk preload failures globally and recover once.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const key = 'vite_preload_reload_attempted';
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, Date.now().toString());
    performDeferrableReload(() => window.location.reload());
  }
});

// 48-hour diagnostic window (no-op for everyone except the two watched users):
// capture crashes / stalled loads that stop the app from opening.
window.addEventListener('error', (e) => {
  debugWatchLog('js_error', { message: (e as ErrorEvent).message, source: (e as ErrorEvent).filename });
});
window.addEventListener('unhandledrejection', (e) => {
  debugWatchLog('promise_rejection', { reason: String((e as PromiseRejectionEvent).reason).slice(0, 300) });
});
document.addEventListener('visibilitychange', () => {
  debugWatchLog('visibility', { state: document.visibilityState });
});

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
} else {
  console.error('[Main] Root element not found!');
}

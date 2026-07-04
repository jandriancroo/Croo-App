import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { syncChromeColor } from "./utils/syncChrome";

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

// Emergency SW cleanup: a stale PWA service worker can intercept auth/token
// requests and surface as Safari/Chrome "Load failed", leaving login stuck.
// We are disabling browser SW control for now; push registration is only useful
// after auth is stable and can be reintroduced behind an explicit opt-in.
const disableServiceWorkers = async () => {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) return;

    console.warn(`[SW] Removing ${registrations.length} stale service worker registration(s)`);
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }

    const reloadKey = 'sw_cleanup_reload_attempted';
    if (!sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, 'true');
      window.location.reload();
    }
  } catch (error) {
    console.warn('[SW] Cleanup failed', error);
  }
};

disableServiceWorkers();

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
  if (currentVersion) {
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

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
} else {
  console.error('[Main] Root element not found!');
}

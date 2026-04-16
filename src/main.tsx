import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Kiosk subdomain: manifest is handled in index.html via document.write (before parser).
// No JS swapping needed here — iOS reads manifest from initial HTML parse.
const isKioskSubdomain = window.location.hostname === 'kiosk.croohq.com';
if (isKioskSubdomain) {
  // Update apple-mobile-web-app-title for iOS (belt-and-suspenders with index.html)
  let titleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (!titleMeta) {
    titleMeta = document.createElement('meta');
    titleMeta.setAttribute('name', 'apple-mobile-web-app-title');
    document.head.appendChild(titleMeta);
  }
  titleMeta.setAttribute('content', 'Kiosk');
} // No legacy /kiosk path handling — kiosk is subdomain-only now

// Initialize theme and text size from localStorage before React renders to prevent flash
const THEME_MIGRATION: Record<string, string> = { ocean: 'beach', sage: 'beach', lavender: 'default', vibrant: 'default' };
let savedTheme = localStorage.getItem('app-theme') || 'default';
if (THEME_MIGRATION[savedTheme]) {
  savedTheme = THEME_MIGRATION[savedTheme];
  localStorage.setItem('app-theme', savedTheme);
}
document.documentElement.setAttribute('data-theme', savedTheme);

const savedTextSize = localStorage.getItem('app-text-size') || 'default';
document.documentElement.setAttribute('data-text-size', savedTextSize);

// Mark standalone mode on html element for CSS targeting (iOS fallback)
const isStandaloneMode =
  window.matchMedia?.('(display-mode: standalone)')?.matches ||
  (window.navigator as any).standalone === true;
if (isStandaloneMode) {
  document.documentElement.setAttribute('data-standalone', 'true');
}

// Kiosk PWA guard: on subdomain, all routes are kiosk — no redirect needed.
// No main-domain /kiosk path anymore.

// Force-refresh when a new published version is detected (prevents stale Safari/PWA caches).
// __APP_VERSION__ is injected at build time in vite.config.ts.
declare const __APP_VERSION__: string;
try {
  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined;
  if (currentVersion) {
    const storedVersion = localStorage.getItem('app-version');
    if (storedVersion && storedVersion !== currentVersion) {
      localStorage.setItem('app-version', currentVersion);
      const url = new URL(window.location.href);
      url.searchParams.set('v', currentVersion);
      window.location.replace(url.toString());
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
    window.location.reload();
  }
});

// PWA: Register a minimal service worker for push notifications.
// Required for web push to work in both PWA and browser mode.
// No precaching = no stale version issues. Browser/CDN cache handles freshness.
try {
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (window.navigator as any).standalone === true;

  if ('serviceWorker' in navigator) {
    // Register SW for push notifications in both PWA and browser mode
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      console.log('[SW] Service worker registered for push notifications');
      
      if (isStandalone) {
        // PWA mode: also set up update detection
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version ready - notify the app
                console.log('[PWA] New version available');
                (window as any).__PWA_UPDATE_READY__ = true;
                window.dispatchEvent(new CustomEvent('pwa:update-available'));
              }
            });
          }
        });

        // Check for updates periodically (every 5 min)
        setInterval(() => {
          registration.update();
        }, 5 * 60 * 1000);

        // Check on visibility change (app comes to foreground)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update();
          }
        });
      }
    }).catch((error) => {
      console.warn('[SW] SW registration failed:', error);
    });
  }
} catch (e) {
  console.warn('[SW] SW init skipped', e);
}

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
} else {
  console.error('[Main] Root element not found!');
}

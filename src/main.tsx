import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Initialize theme from localStorage before React renders to prevent flash
const savedTheme = localStorage.getItem('app-theme') || 'default';
document.documentElement.setAttribute('data-theme', savedTheme);

// PWA: Register a minimal service worker for push notifications only.
// No precaching = no stale version issues. Browser/CDN cache handles freshness.
try {
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (window.navigator as any).standalone === true;

  if (isStandalone && 'serviceWorker' in navigator) {
    // PWA mode: register SW for push notifications + update detection
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      console.log('[PWA] Service worker registered for push notifications');
      
      // Listen for new SW installing (means new version available)
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
    }).catch((error) => {
      console.warn('[PWA] SW registration failed:', error);
    });
  } else if (!isStandalone && 'serviceWorker' in navigator) {
    // Website mode: unregister any existing SW to prevent caching issues
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((reg) => {
        reg.unregister();
        console.log('[Website] Unregistered service worker');
      });
    });
  }
} catch (e) {
  console.warn('[PWA] SW init skipped', e);
}

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
} else {
  console.error('[Main] Root element not found!');
}

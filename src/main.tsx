import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// PWA: ensure service worker is registered + checks for updates so PWAs see publishes quickly.
// (vite-plugin-pwa virtual module)
import { registerSW } from "virtual:pwa-register";

// Initialize theme from localStorage before React renders to prevent flash
const savedTheme = localStorage.getItem('app-theme') || 'default';
document.documentElement.setAttribute('data-theme', savedTheme);

// In production, proactively check for updates.
try {
  // Guard against infinite reload loops (some browsers repeatedly emit onNeedRefresh)
  const UPDATE_GUARD_KEY = '__PWA_UPDATE_TRIGGERED__';

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // New content available. DO NOT auto-reload here (can cause refresh loops on some browsers).
      // Instead, signal the UI to show an "Install Update" action.
      if (sessionStorage.getItem(UPDATE_GUARD_KEY) === '1') return;
      sessionStorage.setItem(UPDATE_GUARD_KEY, '1');

      (window as any).__PWA_UPDATE_READY__ = true;
      window.dispatchEvent(new CustomEvent('pwa:need-refresh'));
      console.log('[PWA] Update ready (waiting). Tap Install Update in the app.');
    },
    onOfflineReady() {
      console.log('[PWA] App ready for offline use');
    },
    onRegisteredSW(swUrl, registration) {
      console.log('[PWA] Service worker registered:', swUrl);
      if (registration) {
        // Check immediately on load
        registration.update();

        // Check periodically (less aggressive to avoid iOS/Safari refresh loops)
        setInterval(() => {
          registration.update();
        }, 5 * 60 * 1000);

        // Also check on visibility change (when user returns to app)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update();
          }
        });
      }
    },
    onRegisterError(error) {
      console.warn('[PWA] SW registration error', error);
    },
  });

  // Expose a manual hook for debugging in Safari devtools if needed
  (window as any).__PWA_APPLY_UPDATE__ = () => updateSW(true);
  (window as any).__PWA_UPDATE__ = () => updateSW(true);
  (window as any).__PWA_FORCE_RELOAD__ = () => {
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name));
    });
    window.location.reload();
  };
} catch (e) {
  // Safe no-op in environments where the virtual module isn't available
  console.warn('[PWA] SW init skipped', e);
}
const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
} else {
  console.error('[Main] Root element not found!');
}


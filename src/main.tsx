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
// IMPORTANT: Only register a service worker when running as an installed app (PWA).
// Registering SW on the regular website can cause sticky caching + refresh loops.
try {
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (window.navigator as any).standalone === true;

  if (!isStandalone) {
    // Website mode: remove any previously-installed SW/caches once per build, then skip SW registration.
    // IMPORTANT: Safari can keep an old SW-controlled shell alive until *after* a reload.
    // So after purging, we do a single forced reload to guarantee the newest build loads.
    const PURGE_KEY = `__SW_PURGED_WEBSITE__:${__APP_VERSION__}`;
    const RELOAD_KEY = `__SW_PURGE_RELOAD__:${__APP_VERSION__}`;

    const needsPurge = sessionStorage.getItem(PURGE_KEY) !== '1';
    if (needsPurge) {
      sessionStorage.setItem(PURGE_KEY, '1');

      const tasks: Promise<unknown>[] = [];

      if ('serviceWorker' in navigator) {
        tasks.push(
          navigator.serviceWorker.getRegistrations().then((regs) => {
            regs.forEach((r) => r.unregister());
          })
        );
      }

      if ('caches' in window) {
        tasks.push(
          caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
        );
      }

      Promise.allSettled(tasks).finally(() => {
        // One reload per build to drop any SW-controlled HTML shell.
        if (sessionStorage.getItem(RELOAD_KEY) !== '1') {
          sessionStorage.setItem(RELOAD_KEY, '1');
          window.location.reload();
        }
      });
    }
  } else {
    // PWA mode: register SW and surface updates without auto-refreshing.
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
          registration.update();

          // Check periodically (less aggressive to avoid refresh loops)
          setInterval(() => {
            registration.update();
          }, 5 * 60 * 1000);

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

    // Expose manual hooks
    (window as any).__PWA_APPLY_UPDATE__ = () => updateSW(true);
    (window as any).__PWA_UPDATE__ = () => updateSW(true);
    (window as any).__PWA_FORCE_RELOAD__ = () => {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      });
      window.location.reload();
    };
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


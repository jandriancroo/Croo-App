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
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // Check once soon after load
      registration?.update();
      // Then periodically (helps iOS PWAs)
      window.setInterval(() => registration?.update(), 60 * 1000);
    },
    onRegisterError(error) {
      console.warn('[PWA] SW registration error', error);
    },
  });

  // Expose a manual hook for debugging in Safari devtools if needed
  (window as any).__PWA_UPDATE__ = () => updateSW(true);
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


import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    // Auto version: YY.MM.DD.HHMM format in PST (e.g., "24.12.13.1530")
    __APP_VERSION__: JSON.stringify((() => {
      const pst = new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      // Format: "12/13/24, 15:30" -> "24.12.13.1530"
      const [datePart, timePart] = pst.split(', ');
      const [month, day, year] = datePart.split('/');
      const time = timePart.replace(':', '');
      return `${year}.${month}.${day}.${time}`;
    })()),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(), 
    mode === "development" && componentTagger(),
    VitePWA({
      // Keep users on the latest build automatically (no manual update prompt)
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.png'],
      manifest: {
        name: 'CrooHQ - Food Service Made Smart',
        short_name: 'CrooHQ',
        description: 'All-in-one platform for restaurant scheduling, time tracking, task management, and team communication.',
        theme_color: '#D4A574',
        background_color: '#F5F1E8',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/favicon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/notification-icon.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/notification-icon-monochrome.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'monochrome'
          }
        ]
      },
      workbox: {
        // Precache the actual app bundle too (JS), so new publishes reliably update PWAs
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json,woff2}'],
        navigateFallback: null,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Import the push notification handler into the service worker
        importScripts: ['/sw-push.js']
      },
      devOptions: {
        enabled: false
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

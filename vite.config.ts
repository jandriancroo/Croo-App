import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const buildVersion = (() => {
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
  })();

  return {
    define: {
      // Auto version: YY.MM.DD.HHMM format in PST (e.g., "24.12.13.1530")
      __APP_VERSION__: JSON.stringify(buildVersion),
    },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(), 
    mode === "development" && componentTagger(),
    VitePWA({
      // We handle SW registration manually in main.tsx
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'notification-icon.png', 'notification-icon-monochrome.png'],
      manifest: {
        name: 'CrooHQ - Built for operators, by operators',
        short_name: 'CrooHQ',
        description: 'Built for operators, by operators',
        theme_color: '#03adbb',
        background_color: '#03adbb',
        display: 'standalone',
        orientation: 'any',
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
            src: '/apple-touch-icon.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
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
        // NO PRECACHING - rely on browser/CDN cache for freshness
        globPatterns: [],
        // No runtime caching either
        runtimeCaching: [],
        // Only import push handler
        importScripts: ['/sw-push.js'],
        // Take control immediately
        clientsClaim: true,
        skipWaiting: true,
        // Minimal SW - no navigation fallback (let network handle it)
        navigateFallback: null
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
    // Prevent duplicate React instances causing module import failures
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  };
});

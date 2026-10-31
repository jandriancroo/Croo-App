import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";

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

  // Publishes the SAME build version at /version.json so a sitting kiosk can
  // ask the server whether a newer build exists. Unauthenticated on purpose.
  const versionEndpoint = {
    name: 'croohq-version-endpoint',
    configureServer(server: any) {
      server.middlewares.use('/version.json', (_req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.end(JSON.stringify({ version: buildVersion }));
      });
    },
    generateBundle(this: any) {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: buildVersion, builtAt: new Date().toISOString() }),
      });
    },
  };

  // Crawler-readable homepage: inject the generated text-only snapshot of <Home/>
  // (seo/home-snapshot.html, made by scripts/snapshot-home.mjs) inside #root.
  // createRoot() replaces it on mount; index.html hides/removes it on non-"/" routes.
  const homeSnapshot = {
    name: 'croohq-home-snapshot',
    transformIndexHtml(html: string) {
      const f = path.resolve(__dirname, 'seo/home-snapshot.html');
      if (!fs.existsSync(f)) return html;
      const snap = fs.readFileSync(f, 'utf8').replace(/^<!--.*?-->\n/, '').trim();
      return html.replace('<div id="root"></div>', `<div id="root">${snap}</div>`);
    },
  };

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
    versionEndpoint,
    homeSnapshot,
    mode === "development" && componentTagger(),
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

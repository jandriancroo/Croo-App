import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
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

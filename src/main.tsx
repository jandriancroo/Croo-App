import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPushHandler } from "./sw-push-handler";

// Register push handler in background (non-blocking)
try {
  registerPushHandler();
} catch (e) {
  console.error('[Main] Push handler registration failed:', e);
}

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
} else {
  console.error('[Main] Root element not found!');
}

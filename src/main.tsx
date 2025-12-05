import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPushHandler } from "./sw-push-handler";

console.log('[Main] Starting app initialization');

// Register push notification handler
registerPushHandler();

const rootElement = document.getElementById("root");
console.log('[Main] Root element:', rootElement);

if (rootElement) {
  console.log('[Main] Creating React root');
  const root = createRoot(rootElement);
  console.log('[Main] Rendering App');
  root.render(<App />);
  console.log('[Main] App render called');
} else {
  console.error('[Main] Root element not found!');
}

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPushHandler } from "./sw-push-handler";

// Register push notification handler
registerPushHandler();

createRoot(document.getElementById("root")!).render(<App />);

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Initialize theme from localStorage before React renders to prevent flash
const savedTheme = localStorage.getItem('app-theme') || 'default';
document.documentElement.setAttribute('data-theme', savedTheme);

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
} else {
  console.error('[Main] Root element not found!');
}

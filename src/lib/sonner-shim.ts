// This shim intercepts all `import { toast } from "sonner"` calls
// and routes them through our dock toast on mobile.
// Vite alias in vite.config.ts maps "sonner" -> this file.

export { Toaster } from "sonner/dist/index.mjs";
export { toast } from "@/components/ui/sonner";

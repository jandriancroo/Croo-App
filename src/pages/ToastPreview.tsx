import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

type ToastType = "success" | "error" | "warning" | "info";

interface PreviewToast {
  id: number;
  message: string;
  type: ToastType;
}

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4" />,
  error: <XCircle className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
};

const SAMPLE_MESSAGES: Record<ToastType, string> = {
  success: "Settings saved successfully",
  error: "Failed to save changes",
  warning: "Unsaved changes detected",
  info: "Schedule published for next week",
};

// ─── Style A: Pill (current style, refined) ───
function StyleAPill({ toast, onDismiss }: { toast: PreviewToast; onDismiss: () => void }) {
  const styles: Record<ToastType, string> = {
    success: "bg-foreground text-background",
    error: "bg-destructive text-destructive-foreground",
    warning: "bg-amber-600 text-white",
    info: "bg-foreground text-background",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium ${styles[toast.type]}`}
    >
      {TOAST_ICONS[toast.type]}
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100">
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

// ─── Style B: Glass Card ───
function StyleBGlass({ toast, onDismiss }: { toast: PreviewToast; onDismiss: () => void }) {
  const accents: Record<ToastType, string> = {
    success: "border-emerald-500/40 text-emerald-400",
    error: "border-red-500/40 text-red-400",
    warning: "border-amber-500/40 text-amber-400",
    info: "border-primary/40 text-primary",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, backdropFilter: "blur(0px)" }}
      animate={{ opacity: 1, y: 0, backdropFilter: "blur(16px)" }}
      exit={{ opacity: 0, y: -20 }}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-background/80 backdrop-blur-xl shadow-2xl ${accents[toast.type]}`}
    >
      <div className={accents[toast.type]}>{TOAST_ICONS[toast.type]}</div>
      <span className="text-sm font-medium text-foreground">{toast.message}</span>
      <button onClick={onDismiss} className="ml-auto opacity-40 hover:opacity-100 text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

// ─── Style C: Minimal Bar ───
function StyleCBar({ toast, onDismiss }: { toast: PreviewToast; onDismiss: () => void }) {
  const bars: Record<ToastType, string> = {
    success: "bg-emerald-500",
    error: "bg-red-500",
    warning: "bg-amber-500",
    info: "bg-primary",
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card border shadow-lg overflow-hidden relative"
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${bars[toast.type]}`} />
      <div className={`ml-1 ${bars[toast.type].replace('bg-', 'text-')}`}>{TOAST_ICONS[toast.type]}</div>
      <span className="text-sm font-medium text-foreground">{toast.message}</span>
      <button onClick={onDismiss} className="ml-auto opacity-40 hover:opacity-100 text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

// ─── Style D: Neumorphic Slab ───
function StyleDSlab({ toast, onDismiss }: { toast: PreviewToast; onDismiss: () => void }) {
  const iconColors: Record<ToastType, string> = {
    success: "text-emerald-500",
    error: "text-red-500",
    warning: "text-amber-500",
    info: "text-primary",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.9 }}
      className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-card shadow-neumorphic border border-border/50"
    >
      <div className={`p-1.5 rounded-lg bg-muted ${iconColors[toast.type]}`}>
        {TOAST_ICONS[toast.type]}
      </div>
      <span className="text-sm font-semibold text-foreground">{toast.message}</span>
      <button onClick={onDismiss} className="ml-auto opacity-40 hover:opacity-100 text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

const STYLES = [
  { id: "A", name: "Pill", description: "Current style, refined — compact & clean", Component: StyleAPill },
  { id: "B", name: "Glass Card", description: "Frosted glass with colored accent borders", Component: StyleBGlass },
  { id: "C", name: "Minimal Bar", description: "Left accent bar — subtle & editorial", Component: StyleCBar },
  { id: "D", name: "Neumorphic Slab", description: "Soft shadow card matching CrooHQ's design language", Component: StyleDSlab },
];

const TYPES: ToastType[] = ["success", "error", "warning", "info"];

export default function ToastPreview() {
  const [activeToasts, setActiveToasts] = useState<Record<string, PreviewToast[]>>({});
  let counter = 0;

  const fireToast = (styleId: string, type: ToastType) => {
    const id = ++counter + Date.now();
    const newToast: PreviewToast = { id, message: SAMPLE_MESSAGES[type], type };
    setActiveToasts(prev => ({
      ...prev,
      [styleId]: [...(prev[styleId] || []), newToast],
    }));
    setTimeout(() => dismissToast(styleId, id), 3000);
  };

  const dismissToast = (styleId: string, toastId: number) => {
    setActiveToasts(prev => ({
      ...prev,
      [styleId]: (prev[styleId] || []).filter(t => t.id !== toastId),
    }));
  };

  const fireAll = (styleId: string) => {
    TYPES.forEach((type, i) => {
      setTimeout(() => fireToast(styleId, type), i * 300);
    });
  };

  return (
    <div className="min-h-screen bg-background p-6 space-y-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Toast Design Preview</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-8">
          Pick a unified toast style. These will replace both Sonner (desktop) and dock toasts (mobile).
        </p>

        {STYLES.map(({ id, name, description, Component }) => (
          <div key={id} className="mb-10">
            <div className="flex items-baseline gap-3 mb-1">
              <h2 className="text-lg font-bold text-foreground">Style {id}: {name}</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{description}</p>

            {/* Preview area */}
            <div className="relative rounded-2xl border bg-muted/30 p-6 min-h-[140px] flex flex-col items-center justify-start gap-2">
              {/* Phone frame hint */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-border" />
              
              <div className="mt-4 w-full max-w-sm space-y-2">
                <AnimatePresence mode="popLayout">
                  {(activeToasts[id] || []).map(toast => (
                    <Component key={toast.id} toast={toast} onDismiss={() => dismissToast(id, toast.id)} />
                  ))}
                </AnimatePresence>
              </div>

              {(activeToasts[id] || []).length === 0 && (
                <p className="text-xs text-muted-foreground mt-6">Tap a button below to preview</p>
              )}
            </div>

            {/* Trigger buttons */}
            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="sm" variant="outline" onClick={() => fireToast(id, "success")} className="text-emerald-600">
                ✓ Success
              </Button>
              <Button size="sm" variant="outline" onClick={() => fireToast(id, "error")} className="text-red-500">
                ✕ Error
              </Button>
              <Button size="sm" variant="outline" onClick={() => fireToast(id, "warning")} className="text-amber-500">
                ⚠ Warning
              </Button>
              <Button size="sm" variant="outline" onClick={() => fireToast(id, "info")} className="text-primary">
                ℹ Info
              </Button>
              <Button size="sm" variant="default" onClick={() => fireAll(id)}>
                Fire All
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

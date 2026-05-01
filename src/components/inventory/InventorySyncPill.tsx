import { useEffect, useState } from "react";
import { CheckCircle2, CloudUpload, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  subscribeInventoryCountLock,
  type InventoryCountLockState,
} from "@/utils/inventoryCountLock";

/**
 * "Phone-notepad" sync indicator. Reads the global lock's `pending` counter,
 * which is bumped by the count session whenever an edit lands in the local
 * IndexedDB cache and decremented when the background sync confirms the
 * write to the cloud.
 *
 * States:
 *  - All synced  → green "Saved"
 *  - Pending > 0 → amber "Saving N"
 *  - Offline     → grey "Offline — saved locally"
 */
export function InventorySyncPill({ className }: { className?: string }) {
  const [state, setState] = useState<InventoryCountLockState>({
    active: false,
    reason: null,
    pending: 0,
  });
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => subscribeInventoryCountLock(setState), []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const pending = state.pending;
  const isSynced = pending === 0 && online;
  const isOffline = !online;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        isSynced &&
          "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
        !isSynced &&
          !isOffline &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        isOffline &&
          "border-muted-foreground/30 bg-muted text-muted-foreground",
        className
      )}
    >
      {isOffline ? (
        <>
          <CloudOff className="h-3 w-3" />
          <span>Offline — saved on device</span>
        </>
      ) : isSynced ? (
        <>
          <CheckCircle2 className="h-3 w-3" />
          <span>All saved</span>
        </>
      ) : (
        <>
          <CloudUpload className="h-3 w-3 animate-pulse" />
          <span>Saving {pending}…</span>
        </>
      )}
    </div>
  );
}

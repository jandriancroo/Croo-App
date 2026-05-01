import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  clearInventoryCountLock,
  setInventoryCountLock,
  type InventoryLockReason,
} from "@/utils/inventoryCountLock";

interface UseInventoryCountLockOptions {
  /**
   * When true, the lock is engaged: browser back / swipe-back are blocked,
   * sidebar / location switcher reject clicks, and PWA / chunk auto-reload
   * is deferred. Set to false (and unmount) to release the lock.
   */
  active: boolean;
  /** "active_count" or "edit_mode" — used for the toast wording. */
  reason: InventoryLockReason;
}

/**
 * Installs the popstate guard that blocks browser back, iOS swipe-back, and
 * any other history.back() while a count session is active. The blocked
 * navigation gets undone with history.pushState and the user is shown a
 * toast pointing them at "Save & Exit".
 *
 * The matching click guards on the sidebar + location switcher are wired
 * up in <Layout> via the click capture listener installed there.
 */
export function useInventoryCountLock({ active, reason }: UseInventoryCountLockOptions) {
  // Stable ref so the popstate handler always sees the latest active flag
  const activeRef = useRef(active);
  activeRef.current = active;

  // Push/pop a history entry to trap browser back & iOS swipe-back
  useEffect(() => {
    if (!active) return;

    setInventoryCountLock({ active: true, reason });

    // Drop a sentinel entry so the next "back" pops back to *us*
    try {
      window.history.pushState({ __inventoryLock: true }, "");
    } catch {
      /* ignore */
    }

    const handlePopState = () => {
      if (!activeRef.current) return;
      // Re-pin: push another sentinel so the user stays on the count page
      try {
        window.history.pushState({ __inventoryLock: true }, "");
      } catch {
        /* ignore */
      }
      toast.warning("Use Save & Exit to leave the count.", {
        id: "inv-count-lock-back",
        duration: 2500,
      });
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      clearInventoryCountLock();
    };
  }, [active, reason]);
}

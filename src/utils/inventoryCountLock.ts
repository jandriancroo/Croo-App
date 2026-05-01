/**
 * Global lock that flags when an inventory count session is "in progress" or
 * "in edit mode". While the lock is set:
 *  - The PWA / Vite chunk auto-reload loops in `main.tsx` defer reloading.
 *  - The sidebar / location switcher click guard in <Layout> blocks navigation.
 *  - The popstate guard installed by useInventoryCountLock blocks browser
 *    back, swipe-back, and history.back() with a toast.
 *
 * Save & Exit (and emergency Logout) are the only blessed exit paths.
 *
 * The lock is mirrored on `window.__INVENTORY_COUNT_LOCK__` so non-React
 * code (main.tsx, the service-worker update flow) can read it without
 * importing React.
 */

export type InventoryLockReason = "active_count" | "edit_mode";

export interface InventoryCountLockState {
  active: boolean;
  reason: InventoryLockReason | null;
  /** Number of unsynced items pending in the local cache (for status pill). */
  pending: number;
}

declare global {
  interface Window {
    __INVENTORY_COUNT_LOCK__?: InventoryCountLockState;
  }
}

const LISTENERS = new Set<(state: InventoryCountLockState) => void>();

function readLock(): InventoryCountLockState {
  if (typeof window === "undefined") {
    return { active: false, reason: null, pending: 0 };
  }
  if (!window.__INVENTORY_COUNT_LOCK__) {
    window.__INVENTORY_COUNT_LOCK__ = { active: false, reason: null, pending: 0 };
  }
  return window.__INVENTORY_COUNT_LOCK__;
}

export function getInventoryCountLock(): InventoryCountLockState {
  return readLock();
}

export function setInventoryCountLock(next: Partial<InventoryCountLockState>): void {
  const cur = readLock();
  const merged: InventoryCountLockState = {
    active: next.active ?? cur.active,
    reason: next.reason !== undefined ? next.reason : cur.reason,
    pending: next.pending ?? cur.pending,
  };
  if (typeof window !== "undefined") {
    window.__INVENTORY_COUNT_LOCK__ = merged;
  }
  for (const fn of LISTENERS) {
    try {
      fn(merged);
    } catch {
      /* ignore */
    }
  }
}

export function clearInventoryCountLock(): void {
  setInventoryCountLock({ active: false, reason: null, pending: 0 });
}

export function subscribeInventoryCountLock(
  fn: (state: InventoryCountLockState) => void
): () => void {
  LISTENERS.add(fn);
  // Push current state once on subscribe
  try {
    fn(readLock());
  } catch {
    /* ignore */
  }
  return () => {
    LISTENERS.delete(fn);
  };
}

export function isInventoryCountActive(): boolean {
  return readLock().active === true;
}

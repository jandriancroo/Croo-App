/**
 * Shared "wait before reloading" helper. A reload waits while an inventory
 * count OR a checklist is open, so an app update never wipes work in progress.
 */
import { debugWatchLog } from './debugWatch';

declare global {
  interface Window {
    __CHECKLIST_LOCK__?: { active: boolean };
  }
}

export function setChecklistLock(active: boolean): void {
  try {
    window.__CHECKLIST_LOCK__ = { active };
  } catch {
    /* ignore */
  }
}

export function isChecklistActive(): boolean {
  try {
    return window.__CHECKLIST_LOCK__?.active === true;
  } catch {
    return false;
  }
}

function isInventoryCountActive(): boolean {
  try {
    return (window as any).__INVENTORY_COUNT_LOCK__?.active === true;
  } catch {
    return false;
  }
}

export function isReloadBlocked(): boolean {
  return isInventoryCountActive() || isChecklistActive();
}

/** Reload now, or as soon as no inventory count / checklist is open. */
export function performDeferrableReload(doReload: () => void, reason = 'unknown'): void {
  if (!isReloadBlocked()) {
    debugWatchLog('reload_performed', { reason, deferred: false });
    doReload();
    return;
  }
  const blockedBy = isInventoryCountActive() ? 'inventory_count' : 'checklist';
  console.log(`[Reload] Deferred (${reason}) — ${blockedBy} in progress`);
  debugWatchLog('reload_deferred', { reason, blockedBy });
  const poll = window.setInterval(() => {
    if (!isReloadBlocked()) {
      window.clearInterval(poll);
      debugWatchLog('reload_performed', { reason, deferred: true });
      doReload();
    }
  }, 1000);
}

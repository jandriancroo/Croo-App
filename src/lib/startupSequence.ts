// Login sequence, one thing at a time, only after the Dash has loaded and gone idle:
//   1. manager dash slides up (if requested: 4-hour slot or first-time peek)
//   2. ~5 s later the Spookified invite (or right away if there was no slide-up)
// Nothing opens while a dialog or the manager dash is open; it waits until they close.

const INVITE_DELAY_AFTER_SLIDE_UP_MS = 5000;
const IDLE_SETTLE_MS = 800;

let dashReady = false;
let dashIdle = false;
let slideUpRequested = false;
let slideUpAt: number | null = null;
let dockOpen = false;
let openDock: (() => void) | null = null;
const waiters = new Set<() => void>();

function anyDialogOpen() {
  return !!document.querySelector('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]');
}

function blocked() {
  return dockOpen || anyDialogOpen();
}

function pump() {
  if (!dashIdle) return;
  if (slideUpRequested && slideUpAt === null && openDock && !blocked()) {
    slideUpAt = performance.now();
    openDock();
  }
  waiters.forEach((w) => w());
}

// Re-check whenever dialogs open/close (Radix toggles data-state / pointer-events on body).
let observer: MutationObserver | null = null;
function watch() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => pump());
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
}

/** Dashboard calls this on mount. The sequence starts when the browser is idle afterwards. */
export function markDashReady() {
  if (dashReady) return;
  dashReady = true;
  const go = () => setTimeout(() => { dashIdle = true; watch(); pump(); }, IDLE_SETTLE_MS);
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(go, { timeout: 3000 }); else setTimeout(go, 300);
}

/** Layout registers how to slide the manager dash up (mobile + manager only). */
export function registerDashSlideUp(open: (() => void) | null) {
  openDock = open;
  pump();
}

/** Layout reports dash open/closed so nothing stacks on top of it. */
export function setDockOpenState(open: boolean) {
  dockOpen = open;
  pump();
}

/** Ask for the manager dash to slide up once the Dash is idle (replaces Theo's voice auto-open). */
export function requestDashSlideUp() {
  if (slideUpRequested && slideUpAt === null) return; // already queued
  slideUpRequested = true;
  slideUpAt = null;
  pump();
}

/** Calls `show` once it is the invite's turn. Returns a cancel function. */
export function whenInviteAllowed(show: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const check = () => {
    if (done || !dashIdle) return;
    const slideUpPending = slideUpRequested && slideUpAt === null && !!openDock;
    if (slideUpPending || blocked()) return;
    const wait = slideUpAt === null ? 0 : slideUpAt + INVITE_DELAY_AFTER_SLIDE_UP_MS - performance.now();
    if (wait > 0) {
      if (!timer) timer = setTimeout(() => { timer = null; check(); }, wait);
      return;
    }
    done = true;
    waiters.delete(check);
    show();
  };
  waiters.add(check);
  check();
  return () => { done = true; waiters.delete(check); if (timer) clearTimeout(timer); };
}

/** Safety net: if no dialog is open, a leftover body pointer-events:none is cleared. */
export function installStrayPointerLockGuard(): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  let raf = 0;
  const fix = () => {
    raf = 0;
    if (document.body.style.pointerEvents === 'none' && !anyDialogOpen()) {
      document.body.style.pointerEvents = '';
    }
  };
  const mo = new MutationObserver(() => {
    // Radix sets the lock before its content mounts; check a frame + a beat later.
    if (!raf) raf = window.setTimeout(fix, 300) as unknown as number;
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ['style'], childList: true });
  return () => { mo.disconnect(); if (raf) clearTimeout(raf); };
}

/** Test-only reset. */
export function __resetStartupSequence() {
  dashReady = dashIdle = slideUpRequested = dockOpen = false;
  slideUpAt = null; openDock = null; waiters.clear();
  observer?.disconnect(); observer = null;
}

// Bridge so the onboarding tour (and other features) can open the
// compact manager dashboard ("manager dash") without prop-drilling.
let _setDockOpen: ((open: boolean) => void) | null = null;

export function registerDockControl(setter: (open: boolean) => void) {
  _setDockOpen = setter;
}

export function unregisterDockControl() {
  _setDockOpen = null;
}

export function openDockForTour() {
  _setDockOpen?.(true);
}

export function closeDockForTour() {
  _setDockOpen?.(false);
}

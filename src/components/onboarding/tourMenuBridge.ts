// Tiny bridge so the tour can open the mobile menu without prop-drilling
let _setMenuOpen: ((open: boolean) => void) | null = null;

export function registerMenuControl(setter: (open: boolean) => void) {
  _setMenuOpen = setter;
}

export function unregisterMenuControl() {
  _setMenuOpen = null;
}

export function openMenuForTour() {
  _setMenuOpen?.(true);
}

export function closeMenuForTour() {
  _setMenuOpen?.(false);
}

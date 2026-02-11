import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Detects if the device is a phone (not tablet/desktop).
 * Uses screen dimensions and touch capability to identify phones
 * regardless of current viewport orientation.
 */
function isPhoneDevice(): boolean {
  if (typeof window === "undefined") return false;
  
  // Check if device has touch capability
  const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  
  // Use screen dimensions (physical screen, not viewport) to detect phones
  // Phones typically have screen width or height <= 430px (iPhone 15 Pro Max is 430px)
  // In landscape, the smaller dimension is still the physical width
  const screenMin = Math.min(window.screen.width, window.screen.height);
  const isSmallScreen = screenMin <= 450;
  
  // Also check for coarse pointer (touch) vs fine pointer (mouse)
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  
  // It's a phone if: touch device + small physical screen
  return hasTouch && isSmallScreen && hasCoarsePointer;
}

/**
 * Detects if the device is a tablet (touch + medium screen, not phone).
 * Tablets should always get the desktop/tablet view, never mobile.
 */
function isTabletDevice(): boolean {
  if (typeof window === "undefined") return false;
  
  const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const screenMin = Math.min(window.screen.width, window.screen.height);
  
  // Tablet: touch device with screen larger than a phone
  return hasTouch && hasCoarsePointer && screenMin > 450;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    
    // Phones are always mobile
    if (isPhoneDevice()) return true;
    
    // Tablets are never mobile (prevents flickering at breakpoint boundary)
    if (isTabletDevice()) return false;
    
    // Desktop: fall back to viewport width
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
  });

  React.useEffect(() => {
    // Phones: always mobile, no listener needed
    if (isPhoneDevice()) {
      setIsMobile(true);
      return;
    }
    
    // Tablets: always desktop, no listener needed (prevents flicker)
    if (isTabletDevice()) {
      setIsMobile(false);
      return;
    }
    
    // Desktop browsers: use viewport width
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    setIsMobile(mql.matches);

    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

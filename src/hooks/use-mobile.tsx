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

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    
    // First check if it's a phone device (locked to mobile view)
    if (isPhoneDevice()) return true;
    
    // Otherwise fall back to viewport width for tablets/desktop
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
  });

  React.useEffect(() => {
    // If it's a phone, always stay in mobile mode
    const isPhone = isPhoneDevice();
    if (isPhone) {
      setIsMobile(true);
      return; // No need to listen for viewport changes on phones
    }
    
    // For tablets/desktop, use viewport width
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    setIsMobile(mql.matches);

    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

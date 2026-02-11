import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Detects if the device is a phone (not tablet/desktop).
 * Uses screen dimensions and touch capability to identify phones
 * regardless of current viewport orientation.
 */
function isPhoneDevice(): boolean {
  if (typeof window === "undefined") return false;
  
  const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const screenMin = Math.min(window.screen.width, window.screen.height);
  const isSmallScreen = screenMin <= 450;
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  
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
  
  return hasTouch && hasCoarsePointer && screenMin > 450;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    if (isPhoneDevice()) return true;
    if (isTabletDevice()) return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });

  React.useEffect(() => {
    if (isPhoneDevice()) {
      setIsMobile(true);
      return;
    }
    if (isTabletDevice()) {
      setIsMobile(false);
      return;
    }
    
    // Debounced resize listener with hysteresis to prevent flickering
    // Must go below breakpoint to enter mobile, must go above breakpoint+32px to exit
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let currentIsMobile = window.innerWidth < MOBILE_BREAKPOINT;
    setIsMobile(currentIsMobile);

    const handleResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const width = window.innerWidth;
        if (currentIsMobile && width >= MOBILE_BREAKPOINT + 32) {
          // Hysteresis: must be well above breakpoint to switch to desktop
          currentIsMobile = false;
          setIsMobile(false);
        } else if (!currentIsMobile && width < MOBILE_BREAKPOINT) {
          currentIsMobile = true;
          setIsMobile(true);
        }
      }, 150);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  return isMobile;
}

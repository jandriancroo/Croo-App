import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const LARGE_PHONE_MIN_SCREEN = 430; // iPhone Plus/Max screen min dimension

/**
 * Detects if the device is a phone (not tablet/desktop).
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
 */
function isTabletDevice(): boolean {
  if (typeof window === "undefined") return false;
  
  const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const screenMin = Math.min(window.screen.width, window.screen.height);
  
  return hasTouch && hasCoarsePointer && screenMin > 450;
}

/**
 * Detects if a large phone (Plus/Max) is in landscape orientation.
 */
function isLargePhoneLandscape(): boolean {
  if (typeof window === "undefined") return false;
  if (!isPhoneDevice()) return false;
  
  const screenMin = Math.min(window.screen.width, window.screen.height);
  if (screenMin < LARGE_PHONE_MIN_SCREEN) return false;
  
  // Landscape: viewport width > viewport height
  return window.innerWidth > window.innerHeight;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    
    // Large phone in landscape → show desktop view
    if (isLargePhoneLandscape()) return false;
    
    // Phones in portrait → always mobile
    if (isPhoneDevice()) return true;
    
    // Tablets → always desktop
    if (isTabletDevice()) return false;
    
    // Desktop → viewport width
    return window.innerWidth < MOBILE_BREAKPOINT;
  });

  React.useEffect(() => {
    const phone = isPhoneDevice();
    const tablet = isTabletDevice();
    
    // Tablets: always desktop, no listener needed
    if (tablet) {
      setIsMobile(false);
      return;
    }
    
    if (phone) {
      const screenMin = Math.min(window.screen.width, window.screen.height);
      const isLargePhone = screenMin >= LARGE_PHONE_MIN_SCREEN;
      
      if (!isLargePhone) {
        // Small phone: always mobile
        setIsMobile(true);
        return;
      }
      
      // Large phone: switch based on orientation
      const updateOrientation = () => {
        const landscape = window.innerWidth > window.innerHeight;
        setIsMobile(!landscape);
      };
      
      updateOrientation();
      
      // Listen for orientation changes
      const mql = window.matchMedia('(orientation: landscape)');
      const onChange = () => updateOrientation();
      mql.addEventListener('change', onChange);
      window.addEventListener('resize', onChange);
      
      return () => {
        mql.removeEventListener('change', onChange);
        window.removeEventListener('resize', onChange);
      };
    }
    
    // Desktop browsers: debounced resize with hysteresis
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let currentIsMobile = window.innerWidth < MOBILE_BREAKPOINT;
    setIsMobile(currentIsMobile);

    const handleResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const width = window.innerWidth;
        if (currentIsMobile && width >= MOBILE_BREAKPOINT + 32) {
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

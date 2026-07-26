import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const LARGE_PHONE_MIN_SCREEN = 390; // iPhone Air/Plus/Max screen min dimension

function hasMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

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
    
    // Explicitly phone-sized viewport → mobile UI, even on iPad/editor preview.
    if (hasMobileViewport()) return true;
    
    // Phones in portrait → always mobile
    if (isPhoneDevice()) return true;
    
    // Tablets → always desktop
    if (isTabletDevice()) return false;
    
    // Desktop → viewport width
    return hasMobileViewport();
  });

  React.useEffect(() => {
    const phone = isPhoneDevice();
    const tablet = isTabletDevice();

    // Tablets (iPad, etc): follow viewport width so Lovable's mobile preview
    // toggle (which shrinks the iframe to ~390px) can render the mobile UI.
    if (tablet) {
      let debounceTimerT: ReturnType<typeof setTimeout> | null = null;
      const applyTablet = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      applyTablet();
      const onResizeT = () => {
        if (debounceTimerT) clearTimeout(debounceTimerT);
        debounceTimerT = setTimeout(applyTablet, 150);
      };
      window.addEventListener("resize", onResizeT);
      return () => {
        window.removeEventListener("resize", onResizeT);
        if (debounceTimerT) clearTimeout(debounceTimerT);
      };
    }

    // Small phones (screen < 390): always mobile, no listener needed
    if (phone) {
      const screenMin = Math.min(window.screen.width, window.screen.height);
      const isLargePhone = screenMin >= LARGE_PHONE_MIN_SCREEN;

      if (!isLargePhone) {
        setIsMobile(true);
        return;
      }

      // Large phone: switch based on orientation
      const updateOrientation = () => {
        const landscape = window.innerWidth > window.innerHeight;
        setIsMobile(!landscape);
      };

      updateOrientation();

      const mql = window.matchMedia('(orientation: landscape)');
      const onChange = () => updateOrientation();
      mql.addEventListener('change', onChange);
      window.addEventListener('resize', onChange);

      return () => {
        mql.removeEventListener('change', onChange);
        window.removeEventListener('resize', onChange);
      };
    }

    // Desktop/laptop (and editor preview iframe): debounced resize with hysteresis.
    // Always attach the listener so the layout can flip back to desktop when the
    // window/iframe widens past the breakpoint.
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

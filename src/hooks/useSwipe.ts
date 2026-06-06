import { useRef, useEffect, RefObject } from 'react';

interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number; // px
  maxVerticalDrift?: number; // px — reject if user is scrolling vertically
}

/**
 * Lightweight horizontal-swipe detector for the punch-clock pager.
 * Only triggers on predominantly horizontal swipes; vertical drift cancels
 * the gesture so it doesn't fight pull-to-refresh blockers.
 */
export function useSwipe<T extends HTMLElement>(
  ref: RefObject<T>,
  { onSwipeLeft, onSwipeRight, threshold = 60, maxVerticalDrift = 80 }: SwipeOptions
) {
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
      tracking.current = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking.current) return;
      tracking.current = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;
      if (Math.abs(dy) > maxVerticalDrift) return;
      if (Math.abs(dx) < threshold) return;
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [ref, onSwipeLeft, onSwipeRight, threshold, maxVerticalDrift]);
}

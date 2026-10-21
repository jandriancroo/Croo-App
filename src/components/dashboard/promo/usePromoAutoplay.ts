import { useEffect, useRef, useState } from 'react';

/**
 * Local copy of the cube auto-rotate pattern (setInterval, cleared when frozen).
 * Pause is in-component only. Stops while the app is hidden.
 */
export function usePromoAutoplay({ enabled, count, intervalMs = 8000, onAdvance }: {
  enabled: boolean;
  count: number;
  intervalMs?: number;
  onAdvance: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const advanceRef = useRef(onAdvance);
  advanceRef.current = onAdvance;

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const running = enabled && count > 1 && !paused && !hidden;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => advanceRef.current(), intervalMs);
    return () => window.clearInterval(id);
  }, [running, intervalMs]);

  return { paused, setPaused, running, active: enabled && count > 1 };
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const fn = () => setReduced(mq.matches);
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, []);
  return reduced;
}

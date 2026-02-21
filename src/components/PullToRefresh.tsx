import { useState, useRef, useEffect, ReactNode, useCallback, createContext, useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Context to expose refreshing state to children
const PullToRefreshContext = createContext<{ isRefreshing: boolean }>({ isRefreshing: false });

export const usePullToRefreshState = () => useContext(PullToRefreshContext);

interface PullToRefreshProps {
  children: ReactNode;
  /** Query keys to invalidate on refresh. If not provided, all queries are invalidated. */
  queryKeys?: string[][];
  /** Query keys that should always refetch (no cooldown). Cheap DB reads. */
  alwaysRefreshKeys?: string[][];
  /** Query keys that are cooldown-gated. Expensive API calls. */
  cooldownKeys?: string[][];
  /** Cooldown in milliseconds. Default: 2 minutes */
  cooldownMs?: number;
  /** Callback when refresh completes, passes the display timestamp */
  onRefresh?: (displayTimestamp: Date, wasActualRefresh: boolean) => void;
}

// Track last actual sync time globally per cache key
const lastSyncTimes: Record<string, number> = {};

export const PullToRefresh = ({ 
  children, 
  queryKeys,
  alwaysRefreshKeys,
  cooldownKeys,
  cooldownMs = 2 * 60 * 1000, // 2 minutes default
  onRefresh 
}: PullToRefreshProps) => {
  const queryClient = useQueryClient();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isPulling = useRef(false);

  const threshold = 80;

  // Generate a cache key from cooldown keys for tracking sync time
  const getCacheKey = useCallback(() => {
    const keys = cooldownKeys || queryKeys;
    if (!keys || keys.length === 0) return 'global';
    return keys.map(k => k.join('-')).join('|');
  }, [cooldownKeys, queryKeys]);

  // Use native event listeners with { passive: false } so preventDefault works on iOS
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshing) return;
      if (window.scrollY <= 0) {
        startY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPulling.current || isRefreshing) return;
      const diff = e.touches[0].clientY - startY.current;
      if (diff > 0) {
        e.preventDefault(); // Block native pull-to-refresh on iOS
        const resistance = 0.4;
        setPullDistance(Math.min(diff * resistance, threshold * 1.5));
      }
    };

    const onTouchEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;

      const currentPull = pullDistanceRef.current;
      if (currentPull >= threshold && !isRefreshing) {
        triggerRefresh();
      } else {
        setPullDistance(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [isRefreshing, threshold]);

  // Keep a ref in sync with pullDistance so the touchend handler can read it
  const pullDistanceRef = useRef(0);
  useEffect(() => { pullDistanceRef.current = pullDistance; }, [pullDistance]);

  const triggerRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPullDistance(threshold * 0.6);
    
    const cacheKey = getCacheKey();
    const lastSync = lastSyncTimes[cacheKey] || 0;
    const timeSinceSync = Date.now() - lastSync;
    const isWithinCooldown = timeSinceSync < cooldownMs;
    
    if (alwaysRefreshKeys || cooldownKeys) {
      const promises: Promise<any>[] = [];
      if (alwaysRefreshKeys && alwaysRefreshKeys.length > 0) {
        promises.push(...alwaysRefreshKeys.map(key => 
          queryClient.invalidateQueries({ queryKey: key })
        ));
      }
      if (!isWithinCooldown && cooldownKeys && cooldownKeys.length > 0) {
        promises.push(...cooldownKeys.map(key => 
          queryClient.invalidateQueries({ queryKey: key })
        ));
      }
      const minAnimationPromise = new Promise(resolve => setTimeout(resolve, 1500));
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
      await Promise.all([
        minAnimationPromise,
        Promise.race([Promise.all(promises), timeoutPromise]),
      ]);
      if (!isWithinCooldown) {
        lastSyncTimes[cacheKey] = Date.now();
      }
      onRefresh?.(new Date(), !isWithinCooldown);
    } else {
      const refreshPromise = isWithinCooldown
        ? Promise.resolve()
        : (queryKeys && queryKeys.length > 0
          ? Promise.all(queryKeys.map(key => queryClient.invalidateQueries({ queryKey: key })))
          : queryClient.invalidateQueries());
      const minAnimationPromise = new Promise(resolve => setTimeout(resolve, 1500));
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
      await Promise.all([
        minAnimationPromise,
        Promise.race([refreshPromise, timeoutPromise]),
      ]);
      if (!isWithinCooldown) {
        lastSyncTimes[cacheKey] = Date.now();
      }
      onRefresh?.(new Date(), !isWithinCooldown);
    }
    
    setIsRefreshing(false);
    setPullDistance(0);
  }, [getCacheKey, cooldownMs, alwaysRefreshKeys, cooldownKeys, queryKeys, queryClient, onRefresh, threshold]);

  const progress = Math.min(pullDistance / threshold, 1);
  const isReady = progress >= 1;

  return (
    <PullToRefreshContext.Provider value={{ isRefreshing }}>
      <div ref={containerRef}>
        {/* Pull indicator — animated dot wave */}
        <div 
          className="flex items-center justify-center overflow-hidden"
          style={{ 
            height: pullDistance > 0 ? pullDistance : 0,
            opacity: Math.max(progress * 1.2, isRefreshing ? 1 : 0),
            transition: isPulling.current ? 'none' : 'height 0.3s ease, opacity 0.3s ease',
          }}
        >
          <div className="flex items-center gap-[5px] py-2">
            {[
              'hsl(var(--primary))',
              'hsl(var(--accent))',
              'hsl(var(--primary))',
              'hsl(var(--accent))',
              'hsl(var(--primary))',
            ].map((color, i) => (
              <div
                key={i}
                className="rounded-full transition-all"
                style={{
                  width: isRefreshing ? 8 : 6 + progress * 2,
                  height: isRefreshing ? 8 : 6 + progress * 2,
                  backgroundColor: isReady || isRefreshing
                    ? color
                    : `hsl(var(--muted-foreground) / ${0.25 + progress * 0.4})`,
                  animation: isRefreshing
                    ? `ptr-dot-wave 1s ease-in-out ${i * 0.12}s infinite`
                    : 'none',
                  transform: !isRefreshing && isReady ? `scale(${1 + Math.sin((progress * Math.PI) + i * 0.5) * 0.2})` : undefined,
                }}
              />
            ))}
          </div>
        </div>
        {children}
      </div>
    </PullToRefreshContext.Provider>
  );
};

// Export helper to manually set sync time (useful for initial load)
export const setLastSyncTime = (cacheKey: string, timestamp: number = Date.now()) => {
  lastSyncTimes[cacheKey] = timestamp;
};

// Export helper to get last sync time
export const getLastSyncTime = (cacheKey: string): number | null => {
  return lastSyncTimes[cacheKey] || null;
};

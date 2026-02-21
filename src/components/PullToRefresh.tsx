import { useState, useRef, ReactNode, useCallback, createContext, useContext } from 'react';
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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isRefreshing) return;
    
    // Only allow pull-to-refresh when page is scrolled to top
    if (window.scrollY <= 0) {
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling.current || isRefreshing) return;
    
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    
    if (diff > 0) {
      // Apply resistance to make it feel natural
      const resistance = 0.4;
      setPullDistance(Math.min(diff * resistance, threshold * 1.5));
    }
  };

  const handleTouchEnd = async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold * 0.6);
      
      const cacheKey = getCacheKey();
      const lastSync = lastSyncTimes[cacheKey] || 0;
      const timeSinceSync = Date.now() - lastSync;
      const isWithinCooldown = timeSinceSync < cooldownMs;
      
      // If using split keys pattern
      if (alwaysRefreshKeys || cooldownKeys) {
        const promises: Promise<any>[] = [];
        
        // Always refetch cheap DB reads
        if (alwaysRefreshKeys && alwaysRefreshKeys.length > 0) {
          promises.push(...alwaysRefreshKeys.map(key => 
            queryClient.invalidateQueries({ queryKey: key })
          ));
        }
        
        // Only refetch expensive API calls outside cooldown
        if (!isWithinCooldown && cooldownKeys && cooldownKeys.length > 0) {
          promises.push(...cooldownKeys.map(key => 
            queryClient.invalidateQueries({ queryKey: key })
          ));
        }
        
        // Always play full animation (min 1.5s) regardless of cooldown
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
        // Legacy behavior: single queryKeys array with full cooldown
        const refreshPromise = isWithinCooldown
          ? Promise.resolve()
          : (queryKeys && queryKeys.length > 0
            ? Promise.all(queryKeys.map(key => queryClient.invalidateQueries({ queryKey: key })))
            : queryClient.invalidateQueries());
        
        // Always play full animation (min 1.5s)
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
    }
    
    setPullDistance(0);
  };

  const progress = Math.min(pullDistance / threshold, 1);
  const isReady = progress >= 1;

  return (
    <PullToRefreshContext.Provider value={{ isRefreshing }}>
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
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

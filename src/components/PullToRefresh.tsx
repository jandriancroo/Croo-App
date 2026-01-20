import { useState, useRef, ReactNode, useCallback, createContext, useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Context to expose refreshing state to children
const PullToRefreshContext = createContext<{ isRefreshing: boolean }>({ isRefreshing: false });

export const usePullToRefreshState = () => useContext(PullToRefreshContext);

interface PullToRefreshProps {
  children: ReactNode;
  /** Query keys to invalidate on refresh. If not provided, all queries are invalidated. */
  queryKeys?: string[][];
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

  // Generate a cache key from query keys for tracking sync time
  const getCacheKey = useCallback(() => {
    if (!queryKeys || queryKeys.length === 0) return 'global';
    return queryKeys.map(k => k.join('-')).join('|');
  }, [queryKeys]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const container = containerRef.current;
    if (!container || isRefreshing) return;
    
    // Only allow pull-to-refresh when scrolled to top
    if (container.scrollTop === 0) {
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
      
      // Animation always plays, but behavior differs based on cooldown
      if (isWithinCooldown) {
        // Silent refresh - use cached data but update display timestamp
        // Quick animation (feels responsive)
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Notify parent with display timestamp, mark as cached refresh
        onRefresh?.(new Date(), false);
      } else {
        // Actual refresh - invalidate queries and update sync time
        const refreshPromise = queryKeys && queryKeys.length > 0
          ? Promise.all(queryKeys.map(key => queryClient.invalidateQueries({ queryKey: key })))
          : queryClient.invalidateQueries();
        
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
        
        await Promise.race([refreshPromise, timeoutPromise]);
        
        // Update last sync time
        lastSyncTimes[cacheKey] = Date.now();
        
        // Notify parent with display timestamp, mark as actual refresh
        onRefresh?.(new Date(), true);
      }
      
      setIsRefreshing(false);
    }
    
    setPullDistance(0);
  };

  const progress = Math.min(pullDistance / threshold, 1);

  return (
    <PullToRefreshContext.Provider value={{ isRefreshing }}>
      <div
        ref={containerRef}
        className="h-full overflow-auto"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pull indicator */}
        <div 
          className="flex items-center justify-center overflow-hidden transition-all duration-200"
          style={{ 
            height: pullDistance > 0 ? pullDistance : 0,
            opacity: progress
          }}
        >
          {/* Custom spinner - fast and satisfying */}
          <div className="relative w-10 h-10">
            {/* Outer spinning ring */}
            <svg
              className={`w-full h-full ${isRefreshing ? 'animate-spin' : ''}`}
              style={{ 
                transform: isRefreshing ? undefined : `rotate(${progress * 720}deg)`,
                animationDuration: '0.6s'
              }}
              viewBox="0 0 40 40"
            >
              {/* Background circle */}
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-muted-foreground/20"
              />
              {/* Animated arc - grows as you pull */}
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="text-primary"
                style={{
                  strokeDasharray: `${progress * 80} 100`,
                  strokeDashoffset: 0,
                  transform: 'rotate(-90deg)',
                  transformOrigin: 'center',
                }}
              />
            </svg>
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

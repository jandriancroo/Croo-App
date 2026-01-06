import { useState, useRef, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface PullToRefreshProps {
  children: ReactNode;
}

export const PullToRefresh = ({ children }: PullToRefreshProps) => {
  const queryClient = useQueryClient();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isPulling = useRef(false);

  const threshold = 80;

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
      
      // Invalidate queries with a timeout so it doesn't hang
      const refreshPromise = queryClient.invalidateQueries();
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
      
      await Promise.race([refreshPromise, timeoutPromise]);
      
      setIsRefreshing(false);
    }
    
    setPullDistance(0);
  };

  const progress = Math.min(pullDistance / threshold, 1);

  return (
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
        <div className="relative w-8 h-8">
          {/* Outer spinning ring */}
          <svg
            className={`w-full h-full ${isRefreshing ? 'animate-spin' : ''}`}
            style={{ 
              transform: isRefreshing ? undefined : `rotate(${progress * 720}deg)`,
              animationDuration: '0.6s'
            }}
            viewBox="0 0 32 32"
          >
            {/* Background circle */}
            <circle
              cx="16"
              cy="16"
              r="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-muted-foreground/20"
            />
            {/* Animated arc - grows as you pull */}
            <circle
              cx="16"
              cy="16"
              r="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="text-primary"
              style={{
                strokeDasharray: `${progress * 60} 75`,
                strokeDashoffset: 0,
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
              }}
            />
          </svg>
          
          {/* Center dot that pulses when refreshing */}
          {isRefreshing && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  );
};

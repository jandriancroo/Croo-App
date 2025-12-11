import { useState, useRef, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

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
      
      // Invalidate all queries to refresh data
      await queryClient.invalidateQueries();
      
      // Brief delay to show the refresh happened
      await new Promise(resolve => setTimeout(resolve, 500));
      
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
        <RefreshCw 
          className={`h-6 w-6 text-muted-foreground transition-transform ${isRefreshing ? 'animate-spin' : ''}`}
          style={{ 
            transform: `rotate(${progress * 360}deg)`,
          }}
        />
      </div>
      {children}
    </div>
  );
};

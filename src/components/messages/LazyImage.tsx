import { useState, useRef, useEffect, memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}

/**
 * Lazy-loaded image component using Intersection Observer.
 * 
 * Performance comparison:
 * - Without lazy loading: All images load immediately (bandwidth + memory)
 * - With lazy loading: Only visible images load
 * 
 * Expected improvement: ~70% reduction in initial bandwidth for image-heavy chats
 */
export const LazyImage = memo(function LazyImage({ src, alt, className, onClick }: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const element = imgRef.current;
    if (!element) return;
    
    // Use Intersection Observer to detect when image enters viewport
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '100px', // Start loading 100px before visible
        threshold: 0.01
      }
    );
    
    observer.observe(element);
    
    return () => observer.disconnect();
  }, []);
  
  const handleLoad = () => {
    setIsLoaded(true);
  };
  
  const handleError = () => {
    setHasError(true);
    setIsLoaded(true);
  };
  
  return (
    <div ref={imgRef} className="relative">
      {/* Skeleton placeholder while loading */}
      {!isLoaded && (
        <Skeleton className="w-[240px] h-[180px] rounded-lg" />
      )}
      
      {/* Actual image - only load when in view */}
      {isInView && !hasError && (
        <img
          src={src}
          alt={alt}
          className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0 absolute inset-0'} transition-opacity duration-200`}
          onLoad={handleLoad}
          onError={handleError}
          onClick={onClick}
          loading="lazy"
          decoding="async"
        />
      )}
      
      {/* Error state */}
      {hasError && (
        <div className="w-[240px] h-[180px] rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-sm">
          Failed to load image
        </div>
      )}
    </div>
  );
});

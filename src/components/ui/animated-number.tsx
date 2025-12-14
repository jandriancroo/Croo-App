import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedNumberProps {
  value: string | number | null | undefined;
  fallback?: string;
  className?: string;
}

/**
 * A component that smoothly fades in when values change.
 * Shows cached value immediately, then cross-fades to new value.
 */
export function AnimatedNumber({ value, fallback = "--", className }: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState<string | number | null | undefined>(value);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const prevValueRef = useRef(value);

  useEffect(() => {
    // If value changed and we have a previous value, animate the transition
    if (value !== prevValueRef.current && prevValueRef.current !== undefined) {
      setIsTransitioning(true);
      
      // After fade out, update value and fade in
      const timeout = setTimeout(() => {
        setDisplayValue(value);
        setIsTransitioning(false);
      }, 150); // Half of the transition duration

      return () => clearTimeout(timeout);
    } else {
      setDisplayValue(value);
    }
    
    prevValueRef.current = value;
  }, [value]);

  const showValue = displayValue != null && displayValue !== '' ? displayValue : fallback;

  return (
    <span 
      className={cn(
        "transition-opacity duration-300 ease-out",
        isTransitioning ? "opacity-50" : "opacity-100",
        className
      )}
    >
      {showValue}
    </span>
  );
}

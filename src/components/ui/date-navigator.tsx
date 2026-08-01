import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DateNavigatorProps {
  onPrev: () => void;
  onNext: () => void;
  label: string;
  sublabel?: string;
  canGoNext?: boolean;
  canGoPrev?: boolean;
  className?: string;
  /** When true, makes the navigator slightly narrower (90%) - use when there's a row above it */
  narrow?: boolean;
  /** When true, left-aligns on md+ screens (for schedule page) */
  leftAlignOnDesktop?: boolean;
  /** Visual style: 'solid' (teal fill, default) or 'subtle' (neutral outlined) */
  variant?: 'solid' | 'subtle';
}

export function DateNavigator({ 
  onPrev, 
  onNext, 
  label,
  sublabel,
  canGoNext = true,
  canGoPrev = true,
  className,
  narrow = false,
  leftAlignOnDesktop = false,
  variant = 'solid'
}: DateNavigatorProps) {
  const isSubtle = variant === 'subtle';
  const arrowClasses = isSubtle
    ? "h-7 w-7 p-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:text-muted-foreground/40 rounded-md"
    : "h-8 w-8 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full";
  return (
    <div className={cn(
      "flex justify-center",
      leftAlignOnDesktop && "md:justify-start",
      narrow && "px-[5%]",
      className
    )}>
      <div className={cn(
        isSubtle
          ? "inline-flex items-center justify-between rounded-lg border border-border bg-background px-1.5 py-0.5 gap-0.5"
          : "inline-flex items-center justify-between bg-primary rounded-lg px-3 py-1.5 gap-1",
        className?.includes("w-full") && "w-full"
      )}>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onPrev}
          disabled={!canGoPrev}
          className={arrowClasses}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="text-center px-1">
          <span className={cn(
            "whitespace-nowrap font-semibold",
            isSubtle ? "text-sm md:text-base text-foreground tracking-tight" : "text-base md:text-lg text-primary-foreground"
          )} style={isSubtle ? { fontVariantNumeric: 'tabular-nums' } : undefined}>{label}</span>
          {sublabel && (
            <span className={cn("text-sm ml-1", isSubtle ? "text-muted-foreground" : "text-primary-foreground/80")}>{sublabel}</span>
          )}
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onNext} 
          disabled={!canGoNext}
          className={arrowClasses}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

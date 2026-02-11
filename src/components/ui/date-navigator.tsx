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
  leftAlignOnDesktop = false
}: DateNavigatorProps) {
  return (
    <div className={cn(
      "flex justify-center",
      leftAlignOnDesktop && "md:justify-start",
      narrow && "px-[5%]",
      className
    )}>
      <div className={cn(
        "inline-flex items-center justify-between bg-primary rounded-lg px-3 py-1.5 gap-1",
        className?.includes("w-full") && "w-full"
      )}>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onPrev}
          disabled={!canGoPrev}
          className="h-8 w-8 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="text-center px-1">
          <span className="text-base md:text-lg text-primary-foreground font-semibold whitespace-nowrap">{label}</span>
          {sublabel && (
            <span className="text-sm text-primary-foreground/80 ml-1">{sublabel}</span>
          )}
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onNext} 
          disabled={!canGoNext}
          className="h-8 w-8 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

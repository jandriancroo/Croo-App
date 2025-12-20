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
}

export function DateNavigator({ 
  onPrev, 
  onNext, 
  label,
  sublabel,
  canGoNext = true,
  canGoPrev = true,
  className,
  narrow = false
}: DateNavigatorProps) {
  return (
    <div className={cn(
      "flex justify-center",
      narrow && "px-[5%]",
      className
    )}>
      <div className="flex items-center justify-between bg-primary rounded-full px-1 py-0.5 w-full">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onPrev}
          disabled={!canGoPrev}
          className="h-6 w-6 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center flex-1">
          <span className="text-xs text-primary-foreground font-medium">{label}</span>
          {sublabel && (
            <span className="text-xs text-primary-foreground/80 block">{sublabel}</span>
          )}
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onNext} 
          disabled={!canGoNext}
          className="h-6 w-6 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

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
}

export function DateNavigator({ 
  onPrev, 
  onNext, 
  label,
  sublabel,
  canGoNext = true,
  canGoPrev = true,
  className
}: DateNavigatorProps) {
  return (
    <div className={cn(
      "flex justify-center w-[75%] mx-auto",
      className
    )}>
      <div className="flex items-center justify-between bg-primary rounded-full px-2 py-1 gap-2 w-full">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onPrev}
          disabled={!canGoPrev}
          className="h-7 w-7 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center flex-1">
          <span className="text-sm text-primary-foreground font-medium whitespace-nowrap">{label}</span>
          {sublabel && (
            <span className="text-sm text-primary-foreground/80 ml-1">{sublabel}</span>
          )}
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onNext} 
          disabled={!canGoNext}
          className="h-7 w-7 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

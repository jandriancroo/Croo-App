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
  size?: 'sm' | 'default';
}

export function DateNavigator({ 
  onPrev, 
  onNext, 
  label,
  sublabel,
  canGoNext = true,
  canGoPrev = true,
  className,
  size = 'default'
}: DateNavigatorProps) {
  return (
    <div className={cn("flex justify-center", className)}>
      <div className={cn(
        "flex items-center justify-between bg-primary rounded-full px-1",
        size === 'sm' ? 'py-0.5 gap-2' : 'py-0.5 gap-3',
        "w-auto min-w-[140px] max-w-fit"
      )}>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onPrev}
          disabled={!canGoPrev}
          className={cn(
            "text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full",
            size === 'sm' ? 'h-5 w-5 p-0' : 'h-6 w-6 p-0'
          )}
        >
          <ChevronLeft className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </Button>
        <div className="text-center px-1">
          <span className={cn(
            "text-primary-foreground font-medium whitespace-nowrap",
            size === 'sm' ? 'text-[11px]' : 'text-xs'
          )}>{label}</span>
          {sublabel && (
            <span className={cn(
              "text-primary-foreground/80 block whitespace-nowrap",
              size === 'sm' ? 'text-[10px]' : 'text-xs'
            )}>{sublabel}</span>
          )}
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onNext} 
          disabled={!canGoNext}
          className={cn(
            "text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full",
            size === 'sm' ? 'h-5 w-5 p-0' : 'h-6 w-6 p-0'
          )}
        >
          <ChevronRight className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </Button>
      </div>
    </div>
  );
}

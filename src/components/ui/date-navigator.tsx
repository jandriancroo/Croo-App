import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DateNavigatorProps {
  onPrev: () => void;
  onNext: () => void;
  label: string;
  sublabel?: string;
  canGoNext?: boolean;
  canGoPrev?: boolean;
}

export function DateNavigator({ 
  onPrev, 
  onNext, 
  label,
  sublabel,
  canGoNext = true,
  canGoPrev = true
}: DateNavigatorProps) {
  return (
    <div className="flex items-center justify-between bg-primary rounded-md px-1 py-0.5">
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onPrev}
        disabled={!canGoPrev}
        className="h-6 px-1.5 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="text-center">
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
        className="h-6 px-1.5 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

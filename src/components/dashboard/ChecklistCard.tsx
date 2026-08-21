import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Lock, ChevronRight, GripVertical, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { memo } from "react";
import { cn } from "@/lib/utils";

export interface ChecklistCardProps {
  checklistId: string;
  title: string;
  completed: number;
  expected: number;
  accentColor?: string;
  onClick?: () => void;
  dragHandleProps?: any;
  isDragging?: boolean;
  isOverdue?: boolean;
  isLocked?: boolean;
  lockUntilTime?: string;
  /** 'card' = standalone card (default), 'row' = flat row for use inside a container */
  variant?: 'card' | 'row';
}

export const ChecklistCard = memo(function ChecklistCard({ 
  checklistId,
  title, 
  completed, 
  expected,
  accentColor,
  onClick,
  dragHandleProps,
  isDragging = false,
  isOverdue = false,
  isLocked = false,
  lockUntilTime,
  variant = 'card',
}: ChecklistCardProps) {
  const navigate = useNavigate();
  const completionRate = expected > 0 ? Math.min(100, Math.round((completed / expected) * 100)) : 0;
  const isComplete = completionRate === 100;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/complete/${checklistId}`);
    }
  };

  const innerContent = (
    <>
      {/* Left accent border - only for standalone card variant */}
      {variant === 'card' && (
        <div 
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
          style={{ 
            background: isComplete 
              ? 'hsl(var(--primary))' 
              : isLocked 
                ? 'hsl(var(--muted))' 
                : 'hsl(var(--primary) / 0.5)' 
          }} 
        />
      )}

      <div className={cn("flex items-center gap-3 pl-5 pr-4", variant === 'row' ? 'py-2.5' : 'py-3.5')}>
        {/* Drag handle */}
        {dragHandleProps && (
          <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing shrink-0 -ml-1" onClick={e => e.stopPropagation()}>
            <GripVertical className="h-4 w-4 text-muted-foreground/50" />
          </div>
        )}

        {/* Dynamic ring icon */}
        <div className={cn("relative shrink-0", variant === 'row' ? 'w-10 h-10' : 'w-12 h-12')}>
          <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="20" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
            {!isLocked && (
              <circle
                cx="24" cy="24" r="20" fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="3" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 20}
                strokeDashoffset={isComplete ? 0 : (2 * Math.PI * 20) - (completionRate / 100) * (2 * Math.PI * 20)}
                className="transition-all duration-700"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {isLocked ? (
              <Lock className="h-4 w-4 text-muted-foreground" />
            ) : isComplete ? (
              <Check className="h-5 w-5 text-primary" strokeWidth={3} />
            ) : (
              <span className="text-[11px] font-black text-primary">{completionRate}%</span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{title}</span>
          </div>
          {isLocked ? (
            <span className="text-xs text-muted-foreground">
              {lockUntilTime ? `Locked until ${lockUntilTime}` : 'Locked'}
            </span>
          ) : isComplete ? (
            <span className="text-xs text-primary font-medium">All tasks complete ✓</span>
          ) : (
            <div className={cn("flex items-center gap-2", variant === 'row' ? 'mt-1' : 'mt-1.5')}>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div 
                  className="h-full rounded-full bg-primary transition-all duration-500" 
                  style={{ width: `${completionRate}%` }} 
                />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{completed}/{expected}</span>
            </div>
          )}
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      </div>
    </>
  );

  if (variant === 'row') {
    return (
      <div
        className={cn(
          "overflow-hidden relative cursor-pointer hover:bg-muted/30 transition-colors duration-150",
          isDragging ? 'opacity-50' : ''
        )}
        onClick={handleClick}
      >
        {innerContent}
      </div>
    );
  }

  return (
    <Card 
      className={cn(
        "border-0 overflow-hidden relative p-0 cursor-pointer hover:scale-[1.01] transition-all duration-200",
        isDragging ? 'opacity-50 scale-105' : ''
      )}
      onClick={handleClick}
    >
      {innerContent}
    </Card>
  );
});

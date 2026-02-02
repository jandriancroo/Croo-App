import { Card } from "@/components/ui/card";
import { ClipboardCheck, Check, GripVertical, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useIsOledTheme } from "@/hooks/useIsOledTheme";
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
}

export function ChecklistCard({ 
  checklistId,
  title, 
  completed, 
  expected,
  accentColor = '#8B5CF6',
  onClick,
  dragHandleProps,
  isDragging = false,
  isOverdue = false,
  isLocked = false,
  lockUntilTime,
}: ChecklistCardProps) {
  const navigate = useNavigate();
  const isOled = useIsOledTheme();
  const completionRate = expected > 0 ? Math.min(100, Math.round((completed / expected) * 100)) : 0;
  const isComplete = completionRate === 100;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/complete/${checklistId}`);
    }
  };

  // Overdue styling - subtle red border
  const overdueStyles = isOverdue && !isComplete ? {
    borderColor: 'hsl(var(--destructive))',
    borderWidth: '2px',
  } : {};

  return (
    <Card 
      className={cn(
        "aspect-square overflow-hidden cursor-pointer hover:scale-[1.02] transition-all duration-200 relative group border-0",
        isDragging ? 'opacity-50 scale-105' : ''
      )}
      onClick={handleClick}
      style={{
        background: isOled 
          ? 'hsl(var(--card))' 
          : `linear-gradient(135deg, ${accentColor}15 0%, ${accentColor}25 100%)`,
        ...overdueStyles,
      }}
    >
      {/* Progress ring background */}
      <div className="absolute inset-0 flex items-center justify-center opacity-10">
        <svg className="w-24 h-24" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke={isOled ? 'hsl(var(--muted))' : accentColor}
            strokeWidth="8"
            opacity="0.3"
          />
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke={isOled ? 'hsl(var(--muted))' : accentColor}
            strokeWidth="8"
            strokeDasharray={`${completionRate * 2.51} 251`}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            className="transition-all duration-500"
          />
        </svg>
      </div>

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <div 
            className="flex items-center justify-center w-6 h-6 rounded-md"
            style={{ 
              backgroundColor: isOled ? 'hsl(var(--muted))' : `${accentColor}20`,
            }}
          >
            <ClipboardCheck 
              className="h-3.5 w-3.5" 
              style={{ color: isOled ? 'hsl(var(--muted-foreground))' : accentColor }}
            />
          </div>
          <span 
            className="text-[11px] font-semibold truncate flex-1"
            style={{ color: isOled ? 'hsl(var(--muted-foreground))' : accentColor }}
          >
            {title}
          </span>
          {dragHandleProps && (
            <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()}>
              <GripVertical className="h-4 w-4 text-muted-foreground/50" />
            </div>
          )}
        </div>
        
        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {isLocked ? (
            <>
              <div 
                className="flex items-center justify-center w-12 h-12 rounded-full mb-2 shadow-lg bg-muted"
              >
                <Lock 
                  className="h-6 w-6 text-muted-foreground" 
                  strokeWidth={2.5}
                />
              </div>
              <div className="text-xs text-muted-foreground font-medium text-center">
                {lockUntilTime ? `Until ${lockUntilTime}` : 'Locked'}
              </div>
            </>
          ) : isComplete ? (
            <>
              <div 
                className="flex items-center justify-center w-12 h-12 rounded-full mb-2 shadow-lg"
                style={{ 
                  backgroundColor: isOled ? 'hsl(var(--muted))' : accentColor,
                }}
              >
                <Check 
                  className="h-6 w-6 text-white" 
                  strokeWidth={3}
                />
              </div>
              <div className="text-sm font-bold text-foreground">Done!</div>
            </>
          ) : (
            <>
              <div 
                className="text-4xl font-black tracking-tight"
                style={{ color: isOled ? 'hsl(var(--foreground))' : accentColor }}
              >
                {completionRate}%
              </div>
              <div className="text-xs text-muted-foreground font-medium mt-1">
                {completed} of {expected}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Decorative corner */}
      <div 
        className="absolute -bottom-3 -right-3 w-12 h-12 rounded-full opacity-20 group-hover:opacity-30 transition-opacity"
        style={{ backgroundColor: isOled ? 'hsl(var(--muted))' : accentColor }}
      />
    </Card>
  );
}
import { Card } from "@/components/ui/card";
import { ListTodo, Check, Clock, GripVertical } from "lucide-react";
import { useIsOledTheme } from "@/hooks/useIsOledTheme";

export interface TaskCubeProps {
  taskId: string;
  title: string;
  dueTime?: string;
  isCompleted?: boolean;
  subtaskCount?: number;
  completedSubtasks?: number;
  accentColor?: string;
  onClick?: () => void;
  dragHandleProps?: any;
  isDragging?: boolean;
}

export function TaskCube({ 
  taskId,
  title, 
  dueTime,
  isCompleted = false,
  subtaskCount = 0,
  completedSubtasks = 0,
  accentColor = '#F59E0B',
  onClick,
  dragHandleProps,
  isDragging = false,
}: TaskCubeProps) {
  const isOled = useIsOledTheme();
  const hasSubtasks = subtaskCount > 0;
  const completionRate = hasSubtasks && subtaskCount > 0 
    ? Math.min(100, Math.round((completedSubtasks / subtaskCount) * 100)) 
    : isCompleted ? 100 : 0;

  return (
    <Card 
      className={`aspect-square overflow-hidden cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all duration-200 relative group ${isDragging ? 'opacity-50 shadow-2xl scale-105' : ''} ${isCompleted ? 'opacity-60' : ''}`}
      onClick={onClick}
      style={{
        background: isOled 
          ? 'hsl(var(--card))' 
          : `linear-gradient(135deg, ${accentColor}08 0%, ${accentColor}15 100%)`,
        borderColor: isOled ? undefined : `${accentColor}25`,
      }}
    >
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
            <ListTodo 
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
          {isCompleted ? (
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
          ) : hasSubtasks ? (
            <>
              <div 
                className="text-4xl font-black tracking-tight"
                style={{ color: isOled ? 'hsl(var(--foreground))' : accentColor }}
              >
                {completionRate}%
              </div>
              <div className="text-xs text-muted-foreground font-medium mt-1">
                {completedSubtasks} of {subtaskCount}
              </div>
            </>
          ) : (
            <>
              {dueTime && (
                <div 
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full mb-2"
                  style={{ 
                    backgroundColor: isOled ? 'hsl(var(--muted))' : `${accentColor}15`,
                  }}
                >
                  <Clock className="h-3.5 w-3.5" style={{ color: isOled ? 'hsl(var(--muted-foreground))' : accentColor }} />
                  <span 
                    className="text-sm font-bold"
                    style={{ color: isOled ? 'hsl(var(--foreground))' : accentColor }}
                  >
                    {dueTime}
                  </span>
                </div>
              )}
              {!dueTime && (
                <div 
                  className="text-lg font-bold"
                  style={{ color: isOled ? 'hsl(var(--foreground))' : accentColor }}
                >
                  To Do
                </div>
              )}
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
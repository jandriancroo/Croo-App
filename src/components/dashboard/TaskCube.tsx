import { Card, CardContent } from "@/components/ui/card";
import { ListTodo, Check, Clock } from "lucide-react";

interface TaskCubeProps {
  taskId: string;
  title: string;
  dueTime?: string;
  isCompleted?: boolean;
  subtaskCount?: number;
  completedSubtasks?: number;
  accentColor?: string;
  onClick?: () => void;
}

export function TaskCube({ 
  taskId,
  title, 
  dueTime,
  isCompleted = false,
  subtaskCount = 0,
  completedSubtasks = 0,
  accentColor = '#F59E0B',
  onClick
}: TaskCubeProps) {
  const hasSubtasks = subtaskCount > 0;
  const completionRate = hasSubtasks && subtaskCount > 0 
    ? Math.min(100, Math.round((completedSubtasks / subtaskCount) * 100)) 
    : isCompleted ? 100 : 0;

  return (
    <Card 
      className={`aspect-square overflow-hidden cursor-pointer hover:shadow-lg transition-all ${isCompleted ? 'opacity-75' : ''}`}
      style={{ borderLeft: `4px solid ${accentColor}` }}
      onClick={onClick}
    >
      <CardContent className="p-3 h-full flex flex-col justify-between">
        {/* Title */}
        <div className="text-xs font-medium text-muted-foreground truncate">
          {title}
        </div>
        
        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {isCompleted ? (
            <>
              <div 
                className="flex items-center justify-center w-10 h-10 rounded-full mb-1"
                style={{ backgroundColor: `${accentColor}20` }}
              >
                <Check className="h-6 w-6" style={{ color: accentColor }} />
              </div>
              <div className="text-xs text-muted-foreground font-medium">Done</div>
            </>
          ) : hasSubtasks ? (
            <>
              <div 
                className="text-3xl font-extrabold"
                style={{ color: accentColor }}
              >
                {completionRate}%
              </div>
              <div className="text-xs text-muted-foreground font-medium">
                {completedSubtasks}/{subtaskCount}
              </div>
            </>
          ) : (
            <>
              {dueTime && (
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Clock className="h-4 w-4" />
                </div>
              )}
              <div 
                className="text-lg font-bold text-center"
                style={{ color: accentColor }}
              >
                {dueTime || 'To Do'}
              </div>
            </>
          )}
        </div>

        {/* Icon indicator */}
        <div className="flex justify-end">
          <ListTodo className="h-4 w-4 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
}

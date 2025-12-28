import { Card, CardContent } from "@/components/ui/card";
import { ListTodo, Check, Clock, GripVertical } from "lucide-react";

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
  const hasSubtasks = subtaskCount > 0;
  const completionRate = hasSubtasks && subtaskCount > 0 
    ? Math.min(100, Math.round((completedSubtasks / subtaskCount) * 100)) 
    : isCompleted ? 100 : 0;

  return (
    <Card 
      className={`aspect-square overflow-hidden cursor-pointer hover:shadow-lg transition-all relative ${isDragging ? 'opacity-50 shadow-2xl' : ''} ${isCompleted ? 'opacity-75' : ''}`}
      onClick={onClick}
    >
      {/* Colored header */}
      <div className="px-3 py-2 flex items-center" style={{ backgroundColor: accentColor }}>
        <span className="text-xs font-semibold text-white truncate flex-1">{title}</span>
        {dragHandleProps && (
          <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing ml-1" onClick={e => e.stopPropagation()}>
            <GripVertical className="h-3 w-3 text-white/70" />
          </div>
        )}
      </div>
      
      <CardContent className="p-3 h-[calc(100%-32px)] flex flex-col justify-center">
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

        {/* Corner accent with icon */}
        <div 
          className="absolute bottom-0 right-0 w-12 h-12 rounded-tl-full flex items-end justify-end"
          style={{ backgroundColor: accentColor }}
        >
          <ListTodo className="w-4 h-4 text-white mr-2 mb-2" />
        </div>
      </CardContent>
    </Card>
  );
}
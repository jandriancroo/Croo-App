import { Card, CardContent } from "@/components/ui/card";
import { ClipboardCheck, Check, GripVertical } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useIsOledTheme } from "@/hooks/useIsOledTheme";

export interface ChecklistCubeProps {
  checklistId: string;
  title: string;
  completed: number;
  expected: number;
  accentColor?: string;
  onClick?: () => void;
  dragHandleProps?: any;
  isDragging?: boolean;
}

export function ChecklistCube({ 
  checklistId,
  title, 
  completed, 
  expected,
  accentColor = '#8B5CF6',
  onClick,
  dragHandleProps,
  isDragging = false,
}: ChecklistCubeProps) {
  const navigate = useNavigate();
  const isOled = useIsOledTheme();
  const completionRate = expected > 0 ? Math.min(100, Math.round((completed / expected) * 100)) : 0;
  const isComplete = completionRate === 100;
  
  // Use primary color for OLED theme instead of custom accent colors
  const effectiveColor = isOled ? 'hsl(215, 30%, 18%)' : accentColor;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/complete/${checklistId}`);
    }
  };

  return (
    <Card 
      className={`aspect-square overflow-hidden cursor-pointer hover:shadow-lg transition-all relative ${isDragging ? 'opacity-50 shadow-2xl' : ''}`}
      onClick={handleClick}
    >
      {/* Colored header */}
      <div className="px-3 py-2 flex items-center" style={{ backgroundColor: effectiveColor }}>
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
          {isComplete ? (
            <>
              <div 
                className="flex items-center justify-center w-10 h-10 rounded-full mb-1"
                style={{ backgroundColor: `${effectiveColor}20` }}
              >
                <Check className="h-6 w-6" style={{ color: effectiveColor }} />
              </div>
              <div className="text-xs text-muted-foreground font-medium">Complete</div>
            </>
          ) : (
            <>
              <div 
                className="text-3xl font-extrabold"
                style={{ color: effectiveColor }}
              >
                {completionRate}%
              </div>
              <div className="text-xs text-muted-foreground font-medium">
                {completed}/{expected}
              </div>
            </>
          )}
        </div>

        {/* Corner accent with icon */}
        <div 
          className="absolute bottom-0 right-0 w-12 h-12 rounded-tl-full flex items-end justify-end"
          style={{ backgroundColor: effectiveColor }}
        >
          <ClipboardCheck className="w-4 h-4 text-white mr-2 mb-2" />
        </div>
      </CardContent>
    </Card>
  );
}
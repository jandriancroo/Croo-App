import { Card, CardContent } from "@/components/ui/card";
import { ClipboardCheck, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ChecklistCubeProps {
  checklistId: string;
  title: string;
  completed: number;
  expected: number;
  accentColor?: string;
  onClick?: () => void;
}

export function ChecklistCube({ 
  checklistId,
  title, 
  completed, 
  expected,
  accentColor = '#8B5CF6',
  onClick
}: ChecklistCubeProps) {
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

  return (
    <Card 
      className="aspect-square overflow-hidden cursor-pointer hover:shadow-lg transition-all"
      style={{ borderLeft: `4px solid ${accentColor}` }}
      onClick={handleClick}
    >
      <CardContent className="p-3 h-full flex flex-col justify-between">
        {/* Title */}
        <div className="text-xs font-medium text-muted-foreground truncate">
          {title}
        </div>
        
        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {isComplete ? (
            <>
              <div 
                className="flex items-center justify-center w-10 h-10 rounded-full mb-1"
                style={{ backgroundColor: `${accentColor}20` }}
              >
                <Check className="h-6 w-6" style={{ color: accentColor }} />
              </div>
              <div className="text-xs text-muted-foreground font-medium">Complete</div>
            </>
          ) : (
            <>
              <div 
                className="text-3xl font-extrabold"
                style={{ color: accentColor }}
              >
                {completionRate}%
              </div>
              <div className="text-xs text-muted-foreground font-medium">
                {completed}/{expected}
              </div>
            </>
          )}
        </div>

        {/* Icon indicator */}
        <div className="flex justify-end">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
}

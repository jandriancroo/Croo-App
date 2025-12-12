import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, CalendarCheck, LucideIcon } from "lucide-react";
import { formatTime12Hour } from "@/lib/utils";

export interface EventCardProps {
  id: string;
  name: string;
  time: string;
  categoryName?: string;
  categoryColor?: string;
  notes?: string;
  /** Whether to show the complete button (only on dashboard) */
  showCompleteButton?: boolean;
  isLoading?: boolean;
  onComplete?: () => void;
  icon?: LucideIcon;
}

const DEFAULT_COLOR = "#6366f1"; // Indigo as default

export function EventCard({
  name,
  time,
  categoryName,
  categoryColor,
  notes,
  showCompleteButton = false,
  isLoading = false,
  onComplete,
  icon: Icon = CalendarCheck,
}: EventCardProps) {
  const accentColor = categoryColor || DEFAULT_COLOR;

  return (
    <Card
      className="overflow-hidden"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="p-2 rounded-lg shrink-0"
            style={{ backgroundColor: `${accentColor}20` }}
          >
            <Icon className="h-4 w-4" style={{ color: accentColor }} />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{name}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              {formatTime12Hour(time)}
              {categoryName && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px]"
                  style={{
                    backgroundColor: `${accentColor}20`,
                    color: accentColor,
                  }}
                >
                  {categoryName}
                </span>
              )}
            </p>
            {notes && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{notes}</p>
            )}
          </div>
        </div>
        {showCompleteButton && onComplete && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1"
            onClick={onComplete}
            disabled={isLoading}
          >
            <Check className="h-3.5 w-3.5" />
            Complete
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

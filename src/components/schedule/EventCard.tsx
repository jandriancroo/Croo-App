import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, CalendarCheck, LucideIcon } from "lucide-react";
import { formatTime12Hour } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface EventCardProps {
  id: string;
  name: string;
  time: string;
  categoryName?: string;
  categoryColor?: string;
  notes?: string;
  showCompleteButton?: boolean;
  isLoading?: boolean;
  onComplete?: () => void;
  icon?: LucideIcon;
}

const DEFAULT_COLOR = "#6366f1";

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
  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const accentColor = categoryColor || DEFAULT_COLOR;

  const handleCardClick = () => {
    if (notes) {
      setShowNotesDialog(true);
    }
  };

  return (
    <>
      <Card
        className={`overflow-hidden ${notes ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}`}
        style={{ borderLeft: `4px solid ${accentColor}` }}
        onClick={handleCardClick}
      >
        <CardContent className="py-2 px-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="p-1.5 rounded shrink-0 self-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <Icon className="h-4 w-4" style={{ color: accentColor }} />
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <p className="font-medium text-sm truncate">{name}</p>
              <p className="text-xs text-muted-foreground">
                {formatTime12Hour(time)}
              </p>
            </div>
          </div>
          {showCompleteButton && onComplete && (
            <Button
              size="sm"
              className="shrink-0 h-8 px-4 rounded-lg text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-sm gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                onComplete();
              }}
              disabled={isLoading}
            >
              <Check className="h-3.5 w-3.5" />
              Done
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={showNotesDialog} onOpenChange={setShowNotesDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div
                className="p-1.5 rounded-md"
                style={{ backgroundColor: `${accentColor}20` }}
              >
                <Icon className="h-4 w-4" style={{ color: accentColor }} />
              </div>
              {name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{formatTime12Hour(time)}</span>
              {categoryName && (
                <span
                  className="px-1.5 py-0.5 rounded text-xs"
                  style={{
                    backgroundColor: `${accentColor}20`,
                    color: accentColor,
                  }}
                >
                  {categoryName}
                </span>
              )}
            </div>
            {notes && (
              <p className="text-sm">{notes}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

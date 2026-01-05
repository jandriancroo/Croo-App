import { Card, CardContent } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";

interface SharedTaskMessageProps {
  title: string;
  details?: string;
  accentColor?: string;
  senderName: string;
}

export function SharedTaskMessage({ 
  title, 
  details, 
  accentColor = "#8B5CF6",
  senderName 
}: SharedTaskMessageProps) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {senderName} shared a task
      </p>
      <Card
        className="overflow-hidden bg-card/80 backdrop-blur-sm max-w-[280px]"
        style={{ borderLeft: `4px solid ${accentColor}` }}
      >
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-3">
            <div
              className="p-2 rounded-lg shrink-0"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <ClipboardList className="h-5 w-5" style={{ color: accentColor }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm leading-tight">{title}</p>
              {details && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {details}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

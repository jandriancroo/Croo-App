import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { format } from "date-fns";

interface AvailabilityCardProps {
  request: {
    id: string;
    time_scope: string;
    start_time: string | null;
    end_time: string | null;
    status: string;
  };
}

export function AvailabilityCard({ request }: AvailabilityCardProps) {
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes}${ampm}`;
  };

  return (
    <Card
      className="p-2 bg-muted/30 border-dashed border-2 relative"
      style={{
        background: "repeating-linear-gradient(45deg, rgba(0,0,0,0.02), rgba(0,0,0,0.02) 10px, transparent 10px, transparent 20px)",
      }}
    >
      <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {request.time_scope === "partial_day" && request.start_time && request.end_time
          ? `${formatTime(request.start_time)} - ${formatTime(request.end_time)}`
          : "Time Off"}
      </div>
      <div className="flex gap-1 mt-1">
        <Badge
          variant={request.status === "pending" ? "outline" : "secondary"}
          className="text-xs"
        >
          {request.status === "pending" ? "Pending" : "Approved"}
        </Badge>
      </div>
    </Card>
  );
}

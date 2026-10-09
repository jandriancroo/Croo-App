import { AlertCircle, CalendarOff, Clock } from "lucide-react";
import { DateTime } from "luxon";
import { formatTime12h } from "@/types/availability";

export interface TimeOffDetail {
  id?: string;
  request_type?: string;
  status?: string;
  time_scope?: string;
  start_time?: string | null;
  end_time?: string | null;
  start_date?: string;
  end_date?: string | null;
  notes?: string | null;
}

export function AvailabilityDetails({ lines }: { lines: string[] }) {
  return <div className="space-y-2">
    <div className="flex items-center gap-2 text-sm font-medium"><Clock className="h-4 w-4 text-muted-foreground" />Weekly Availability</div>
    <div className="text-sm text-muted-foreground whitespace-pre-line">{lines.join("\n")}</div>
  </div>;
}

export function TimeOffRequestDetails({ request }: { request: TimeOffDetail }) {
  const dateLabel = (date: string) => DateTime.fromFormat(date, "yyyy-MM-dd").toFormat("MMM d");
  return <div className="space-y-3">
    <div className="flex items-center gap-2">
      <CalendarOff className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-medium">{request.request_type === "time_off" ? "Time Off Request" : "Availability Request"}</span>
      {request.status === "pending" && <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--warning-soft))] text-[hsl(var(--warning))]">Pending</span>}
      {request.status === "approved" && <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--success-soft))] text-[hsl(var(--success))]">Approved</span>}
    </div>
    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5 shrink-0" />
      {request.time_scope === "partial_day" && request.start_time && request.end_time
        ? `${formatTime12h(request.start_time)} - ${formatTime12h(request.end_time)}`
        : request.time_scope === "multi_day" && request.start_date && request.end_date
          ? `${dateLabel(request.start_date)} - ${dateLabel(request.end_date)}` : "Full day"}
    </div>
    {request.notes && <div className="pt-2 border-t border-border flex items-start gap-2 text-sm text-muted-foreground"><AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{request.notes}</span></div>}
  </div>;
}
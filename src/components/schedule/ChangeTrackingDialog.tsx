import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Loader2, Plus, Minus, RefreshCw, User } from "lucide-react";

interface ChangeTrackingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleId: string | null;
  weekStartDate: Date;
  isPublished: boolean;
}

interface ChangeLogEntry {
  id: string;
  change_type: string;
  old_shift_data: any;
  new_shift_data: any;
  created_at: string;
  changed_by: string | null;
  user_id: string;
  is_draft: boolean;
  profiles: { full_name: string } | null;
  changer: { full_name: string } | null;
}

export function ChangeTrackingDialog({
  open,
  onOpenChange,
  scheduleId,
  weekStartDate,
  isPublished,
}: ChangeTrackingDialogProps) {
  const { data: changes, isLoading } = useQuery({
    queryKey: ["schedule-changes", scheduleId],
    queryFn: async () => {
      if (!scheduleId) return [];

      // First get the change logs
      const { data: logs, error } = await supabase
        .from("schedule_change_log")
        .select(`
          id,
          change_type,
          old_shift_data,
          new_shift_data,
          created_at,
          changed_by,
          user_id,
          is_draft,
          profiles:user_id(full_name)
        `)
        .eq("schedule_id", scheduleId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      // Get unique changer IDs and fetch their names
      const changerIds = [...new Set(logs?.map(l => l.changed_by).filter(Boolean) || [])];
      let changerMap: Record<string, string> = {};
      
      if (changerIds.length > 0) {
        const { data: changers } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", changerIds);
        
        changerMap = (changers || []).reduce((acc, c) => {
          acc[c.id] = c.full_name;
          return acc;
        }, {} as Record<string, string>);
      }
      
      // Map the results with changer names
      return (logs || []).map(log => ({
        ...log,
        changer: log.changed_by ? { full_name: changerMap[log.changed_by] || "Unknown" } : null
      })) as ChangeLogEntry[];
    },
    enabled: open && !!scheduleId,
  });

  const formatTime = (time: string) => {
    if (!time) return "";
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getChangeIcon = (type: string) => {
    switch (type) {
      case "added":
        return <Plus className="h-4 w-4 text-green-500" />;
      case "removed":
        return <Minus className="h-4 w-4 text-red-500" />;
      case "modified":
        return <RefreshCw className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getChangeBadgeVariant = (type: string) => {
    switch (type) {
      case "added":
        return "default";
      case "removed":
        return "destructive";
      case "modified":
        return "secondary";
      default:
        return "outline";
    }
  };

  const formatShiftInfo = (shiftData: any) => {
    if (!shiftData) return "N/A";
    const date = shiftData.shift_date
      ? format(new Date(shiftData.shift_date + "T12:00:00"), "EEE, MMM d")
      : "";
    const time = `${formatTime(shiftData.start_time)} - ${formatTime(shiftData.end_time)}`;
    return `${date} • ${time}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Change Tracking
            <Badge variant="outline" className="text-xs font-normal">
              Week of {format(weekStartDate, "MMM d, yyyy")}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {!isPublished ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="text-sm">
              Change tracking starts after the schedule is published.
            </p>
            <p className="text-xs mt-2">
              Publish the schedule to begin tracking changes.
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !changes || changes.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="text-sm">No changes recorded since publishing.</p>
            <p className="text-xs mt-2">
              Changes will appear here when shifts are added, removed, or modified.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-2">
              {changes.map((change) => (
                <div
                  key={change.id}
                  className="border rounded-lg p-3 bg-card"
                >
                  {/* Row 1: Change type, status, employee, shift info */}
                  <div className="flex items-center gap-2 text-sm">
                    {getChangeIcon(change.change_type)}
                    <Badge variant={getChangeBadgeVariant(change.change_type)} className="text-xs">
                      {change.change_type.charAt(0).toUpperCase() + change.change_type.slice(1)}
                    </Badge>
                    <Badge 
                      variant="outline"
                      className={`text-xs ${change.is_draft ? "text-yellow-600 border-yellow-500" : "text-green-600 border-green-500"}`}
                    >
                      {change.is_draft ? "Draft" : "Live"}
                    </Badge>
                    <span className="font-medium">
                      {change.profiles?.full_name || "Unknown"}
                    </span>
                    <span className="text-muted-foreground">—</span>
                    <span className="text-muted-foreground">
                      {change.change_type === "removed" && change.old_shift_data
                        ? formatShiftInfo(change.old_shift_data)
                        : formatShiftInfo(change.new_shift_data)}
                    </span>
                  </div>
                  
                  {/* Row 2: Who made the change + timestamp */}
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Changed by: {change.changed_by ? (change.changer?.full_name || "Unknown") : "System"}
                    </span>
                    <span>•</span>
                    <span>{format(new Date(change.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

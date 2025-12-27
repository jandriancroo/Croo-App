import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Users } from "lucide-react";

interface HourlyCoverageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekTemplateId: string;
  dayOfWeek: number;
  dayName: string;
  locationHours?: { open: string; close: string } | null;
}

interface HourlyCoverage {
  hour: number;
  min_staff: number;
}

export function HourlyCoverageDialog({
  open,
  onOpenChange,
  weekTemplateId,
  dayOfWeek,
  dayName,
  locationHours,
}: HourlyCoverageDialogProps) {
  const [coverage, setCoverage] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Default hours if location hours not set
  const defaultOpenHour = 6;
  const defaultCloseHour = 22;

  const openHour = locationHours?.open 
    ? parseInt(locationHours.open.split(':')[0]) 
    : defaultOpenHour;
  const closeHour = locationHours?.close 
    ? parseInt(locationHours.close.split(':')[0]) 
    : defaultCloseHour;

  // Generate hours array for the day
  const hours = [];
  for (let h = openHour; h <= closeHour; h++) {
    hours.push(h);
  }

  useEffect(() => {
    if (open && weekTemplateId) {
      fetchCoverage();
    }
  }, [open, weekTemplateId, dayOfWeek]);

  const fetchCoverage = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("week_template_hourly_coverage")
        .select("hour, min_staff")
        .eq("week_template_id", weekTemplateId)
        .eq("day_of_week", dayOfWeek);

      if (error) throw error;

      const coverageMap = new Map<number, number>();
      (data || []).forEach((item) => {
        coverageMap.set(item.hour, item.min_staff);
      });
      setCoverage(coverageMap);
    } catch (error) {
      console.error("Error fetching coverage:", error);
      toast.error("Failed to load coverage");
    } finally {
      setLoading(false);
    }
  };

  const handleCoverageChange = (hour: number, value: string) => {
    const numValue = parseInt(value) || 0;
    setCoverage((prev) => {
      const newMap = new Map(prev);
      if (numValue > 0) {
        newMap.set(hour, numValue);
      } else {
        newMap.delete(hour);
      }
      return newMap;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      // Delete existing coverage for this day
      await supabase
        .from("week_template_hourly_coverage")
        .delete()
        .eq("week_template_id", weekTemplateId)
        .eq("day_of_week", dayOfWeek);

      // Insert new coverage
      const coverageRows: { 
        week_template_id: string; 
        day_of_week: number; 
        hour: number; 
        min_staff: number 
      }[] = [];

      coverage.forEach((minStaff, hour) => {
        if (minStaff > 0) {
          coverageRows.push({
            week_template_id: weekTemplateId,
            day_of_week: dayOfWeek,
            hour,
            min_staff: minStaff,
          });
        }
      });

      if (coverageRows.length > 0) {
        const { error } = await supabase
          .from("week_template_hourly_coverage")
          .insert(coverageRows);

        if (error) throw error;
      }

      toast.success("Coverage saved");
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving coverage:", error);
      toast.error("Failed to save coverage");
    } finally {
      setSaving(false);
    }
  };

  const formatHour = (hour: number) => {
    if (hour === 0) return "12 AM";
    if (hour === 12) return "12 PM";
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {dayName} - Minimum Staff Coverage
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-4">
              Set minimum staff required for each hour. The auto-scheduler will
              respect these minimums when generating schedules.
            </p>

            <div className="grid grid-cols-2 gap-2">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg"
                >
                  <span className="text-sm font-medium w-16">
                    {formatHour(hour)}
                  </span>
                  <Input
                    type="number"
                    min="0"
                    max="50"
                    value={coverage.get(hour) || ""}
                    onChange={(e) => handleCoverageChange(hour, e.target.value)}
                    className="h-8 w-16 text-center"
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Coverage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

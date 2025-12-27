import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Users, Clock } from "lucide-react";

interface HourlyCoverageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekTemplateId: string;
  dayOfWeek: number;
  dayName: string;
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
}: HourlyCoverageDialogProps) {
  const [coverage, setCoverage] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startHour, setStartHour] = useState(6);
  const [endHour, setEndHour] = useState(22);

  // Generate all 24 hours for the selectors
  const allHours = Array.from({ length: 24 }, (_, i) => i);

  // Generate hours array based on start/end, handling overnight
  const displayHours = useMemo(() => {
    const hours: number[] = [];
    if (endHour > startHour) {
      // Normal day (e.g., 6am to 10pm)
      for (let h = startHour; h <= endHour; h++) {
        hours.push(h);
      }
    } else if (endHour < startHour) {
      // Overnight (e.g., 6am to 2am next day)
      // First, hours from start to midnight
      for (let h = startHour; h <= 23; h++) {
        hours.push(h);
      }
      // Then hours from midnight to end
      for (let h = 0; h <= endHour; h++) {
        hours.push(h);
      }
    } else {
      // Same hour (24-hour coverage)
      for (let h = 0; h <= 23; h++) {
        hours.push(h);
      }
    }
    return hours;
  }, [startHour, endHour]);

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
      let minHour = 23;
      let maxHour = 0;
      
      (data || []).forEach((item) => {
        coverageMap.set(item.hour, item.min_staff);
        if (item.hour < minHour) minHour = item.hour;
        if (item.hour > maxHour) maxHour = item.hour;
      });
      
      setCoverage(coverageMap);
      
      // If we have existing data, try to infer start/end hours
      if (data && data.length > 0) {
        // Check if it's an overnight setup by looking for gaps
        const sortedHours = [...coverageMap.keys()].sort((a, b) => a - b);
        
        // Detect overnight: if there's a large gap in the middle
        let maxGap = 0;
        let gapStart = -1;
        for (let i = 0; i < sortedHours.length - 1; i++) {
          const gap = sortedHours[i + 1] - sortedHours[i];
          if (gap > maxGap) {
            maxGap = gap;
            gapStart = sortedHours[i];
          }
        }
        
        if (maxGap > 3) {
          // Likely overnight - gap is the closed period
          // End is before the gap, start is after
          setEndHour(gapStart);
          setStartHour(sortedHours[sortedHours.indexOf(gapStart) + 1] || sortedHours[0]);
        } else {
          // Normal day - use first and last
          setStartHour(minHour);
          setEndHour(maxHour);
        }
      }
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

  const handleApplyToAll = (value: number) => {
    setCoverage((prev) => {
      const newMap = new Map(prev);
      displayHours.forEach((hour) => {
        if (value > 0) {
          newMap.set(hour, value);
        } else {
          newMap.delete(hour);
        }
      });
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

  const isOvernight = endHour < startHour;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Set minimum staff required for each hour. The auto-scheduler will
              respect these minimums when generating schedules.
            </p>

            {/* Time Range Selectors */}
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded-lg">
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Coverage Start
                </Label>
                <Select
                  value={startHour.toString()}
                  onValueChange={(val) => setStartHour(parseInt(val))}
                >
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allHours.map((h) => (
                      <SelectItem key={h} value={h.toString()}>
                        {formatHour(h)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Coverage End
                </Label>
                <Select
                  value={endHour.toString()}
                  onValueChange={(val) => setEndHour(parseInt(val))}
                >
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allHours.map((h) => (
                      <SelectItem key={h} value={h.toString()}>
                        {formatHour(h)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isOvernight && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 p-2 rounded">
                ⏰ Overnight coverage: {formatHour(startHour)} → {formatHour(endHour)} (next day)
              </p>
            )}

            {/* Quick fill */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Quick fill:</span>
              {[1, 2, 3, 4, 5].map((val) => (
                <Button
                  key={val}
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyToAll(val)}
                  className="h-7 w-7 p-0"
                >
                  {val}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleApplyToAll(0)}
                className="h-7 px-2"
              >
                Clear
              </Button>
            </div>

            {/* Hourly grid */}
            <div className="grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto pr-1">
              {displayHours.map((hour, idx) => (
                <div
                  key={`${hour}-${idx}`}
                  className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg"
                >
                  <span className="text-sm font-medium w-16">
                    {formatHour(hour)}
                    {isOvernight && hour < startHour && (
                      <span className="text-[10px] text-muted-foreground ml-1">+1</span>
                    )}
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

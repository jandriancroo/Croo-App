import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Users, Clock, DollarSign, RefreshCw } from "lucide-react";
import { useLocation as useAppLocation } from "@/hooks/useLocation";

interface HourlyCoverageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekTemplateId: string;
  dayOfWeek: number;
  dayName: string;
}

interface HourlyData {
  min_staff: number;
  projected_sales: number;
}

export function HourlyCoverageDialog({
  open,
  onOpenChange,
  weekTemplateId,
  dayOfWeek,
  dayName,
}: HourlyCoverageDialogProps) {
  const { currentLocation } = useAppLocation();
  const [hourlyData, setHourlyData] = useState<Map<number, HourlyData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [startHour, setStartHour] = useState(6);
  const [endHour, setEndHour] = useState(22);

  // Generate all 24 hours for the selectors
  const allHours = Array.from({ length: 24 }, (_, i) => i);

  // Generate hours array based on start/end, handling overnight
  const displayHours = useMemo(() => {
    const hours: number[] = [];
    if (endHour > startHour) {
      for (let h = startHour; h <= endHour; h++) {
        hours.push(h);
      }
    } else if (endHour < startHour) {
      for (let h = startHour; h <= 23; h++) {
        hours.push(h);
      }
      for (let h = 0; h <= endHour; h++) {
        hours.push(h);
      }
    } else {
      for (let h = 0; h <= 23; h++) {
        hours.push(h);
      }
    }
    return hours;
  }, [startHour, endHour]);

  // Calculate totals
  const totals = useMemo(() => {
    let totalSales = 0;
    let totalStaff = 0;
    displayHours.forEach(hour => {
      const data = hourlyData.get(hour);
      if (data) {
        totalSales += data.projected_sales || 0;
        totalStaff += data.min_staff || 0;
      }
    });
    return { totalSales, totalStaff };
  }, [hourlyData, displayHours]);

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
        .select("hour, min_staff, projected_sales")
        .eq("week_template_id", weekTemplateId)
        .eq("day_of_week", dayOfWeek);

      if (error) throw error;

      const dataMap = new Map<number, HourlyData>();
      let minHour = 23;
      let maxHour = 0;
      
      (data || []).forEach((item: any) => {
        dataMap.set(item.hour, {
          min_staff: item.min_staff || 0,
          projected_sales: item.projected_sales || 0,
        });
        if (item.hour < minHour) minHour = item.hour;
        if (item.hour > maxHour) maxHour = item.hour;
      });
      
      setHourlyData(dataMap);
      
      if (data && data.length > 0) {
        const sortedHours = [...dataMap.keys()].sort((a, b) => a - b);
        
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
          setEndHour(gapStart);
          setStartHour(sortedHours[sortedHours.indexOf(gapStart) + 1] || sortedHours[0]);
        } else {
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

  const handleSyncSales = async () => {
    if (!currentLocation?.id) {
      toast.error("No location selected");
      return;
    }

    try {
      setSyncing(true);
      
      // Convert our day_of_week (0=Monday) to JS day (0=Sunday)
      // Our system: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
      // JS system: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
      const jsDayOfWeek = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
      
      // Fetch last 8 weeks of sales data for this location
      const eightWeeksAgo = new Date();
      eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      const startDate = eightWeeksAgo.toISOString().split('T')[0];
      
      const { data: salesData, error } = await supabase
        .from("sales_cache")
        .select("sale_date, hourly_data")
        .eq("location_id", currentLocation.id)
        .gte("sale_date", startDate)
        .not("hourly_data", "is", null);

      if (error) throw error;

      if (!salesData || salesData.length === 0) {
        toast.info("No historical sales data available to sync");
        return;
      }

      // Filter to only matching day of week and aggregate hourly averages
      const hourlyTotals = new Map<number, { total: number; count: number }>();
      
      salesData.forEach((row: any) => {
        const saleDate = new Date(row.sale_date + "T00:00:00");
        if (saleDate.getDay() === jsDayOfWeek && row.hourly_data) {
          const hourlyArray = row.hourly_data as Array<{ hour: number; sales: number }>;
          hourlyArray.forEach((h) => {
            const existing = hourlyTotals.get(h.hour) || { total: 0, count: 0 };
            hourlyTotals.set(h.hour, {
              total: existing.total + (h.sales || 0),
              count: existing.count + 1,
            });
          });
        }
      });

      if (hourlyTotals.size === 0) {
        toast.info(`No ${dayName} sales data found in recent history`);
        return;
      }

      // Calculate averages and update hourlyData
      setHourlyData((prev) => {
        const newMap = new Map(prev);
        hourlyTotals.forEach((totals, hour) => {
          const avgSales = Math.round(totals.total / totals.count);
          const existing = newMap.get(hour) || { min_staff: 0, projected_sales: 0 };
          newMap.set(hour, { ...existing, projected_sales: avgSales });
        });
        return newMap;
      });

      // Also update start/end hours based on sales data
      const salesHours = [...hourlyTotals.keys()].sort((a, b) => a - b);
      if (salesHours.length > 0) {
        setStartHour(salesHours[0]);
        setEndHour(salesHours[salesHours.length - 1]);
      }

      const weeksUsed = new Set(salesData.filter((row: any) => {
        const d = new Date(row.sale_date + "T00:00:00");
        return d.getDay() === jsDayOfWeek;
      }).map((row: any) => row.sale_date)).size;

      toast.success(`Synced averages from ${weeksUsed} ${dayName}s`);
    } catch (error) {
      console.error("Error syncing sales:", error);
      toast.error("Failed to sync sales data");
    } finally {
      setSyncing(false);
    }
  };

  const handleDataChange = (hour: number, field: 'min_staff' | 'projected_sales', value: string) => {
    const numValue = parseInt(value) || 0;
    setHourlyData((prev) => {
      const newMap = new Map(prev);
      const existing = newMap.get(hour) || { min_staff: 0, projected_sales: 0 };
      newMap.set(hour, { ...existing, [field]: numValue });
      return newMap;
    });
  };

  const handleApplyStaffToAll = (value: number) => {
    setHourlyData((prev) => {
      const newMap = new Map(prev);
      displayHours.forEach((hour) => {
        const existing = newMap.get(hour) || { min_staff: 0, projected_sales: 0 };
        newMap.set(hour, { ...existing, min_staff: value });
      });
      return newMap;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      await supabase
        .from("week_template_hourly_coverage")
        .delete()
        .eq("week_template_id", weekTemplateId)
        .eq("day_of_week", dayOfWeek);

      const coverageRows: { 
        week_template_id: string; 
        day_of_week: number; 
        hour: number; 
        min_staff: number;
        projected_sales: number;
      }[] = [];

      hourlyData.forEach((data, hour) => {
        if (data.min_staff > 0 || data.projected_sales > 0) {
          coverageRows.push({
            week_template_id: weekTemplateId,
            day_of_week: dayOfWeek,
            hour,
            min_staff: data.min_staff || 0,
            projected_sales: data.projected_sales || 0,
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
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {dayName} - Hourly Planning
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Set projected hourly sales and minimum staff. Sync pulls averages from recent {dayName}s.
            </p>

            {/* Time Range Selectors */}
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded-lg">
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Start
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
                  End
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
                ⏰ Overnight: {formatHour(startHour)} → {formatHour(endHour)} (next day)
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncSales}
                disabled={syncing}
                className="h-8"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync Sales"}
              </Button>
              <div className="h-4 w-px bg-border" />
              <span className="text-xs text-muted-foreground">Staff:</span>
              {[1, 2, 3, 4, 5].map((val) => (
                <Button
                  key={val}
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyStaffToAll(val)}
                  className="h-7 w-7 p-0"
                >
                  {val}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleApplyStaffToAll(0)}
                className="h-7 px-2 text-xs"
              >
                Clear
              </Button>
            </div>

            {/* Column Headers */}
            <div className="flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground border-b pb-2">
              <span className="w-14">Hour</span>
              <span className="flex-1 flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Proj. Sales
              </span>
              <span className="w-14 text-center flex items-center justify-center gap-1">
                <Users className="h-3 w-3" />
                Min
              </span>
            </div>

            {/* Hourly rows */}
            <div className="space-y-1 max-h-[40vh] overflow-y-auto pr-1">
              {displayHours.map((hour, idx) => {
                const data = hourlyData.get(hour) || { min_staff: 0, projected_sales: 0 };
                return (
                  <div
                    key={`${hour}-${idx}`}
                    className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-sm font-medium w-14">
                      {formatHour(hour)}
                      {isOvernight && hour < startHour && (
                        <span className="text-[10px] text-muted-foreground ml-1">+1</span>
                      )}
                    </span>
                    <div className="flex-1">
                      <div className="relative">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input
                          type="number"
                          min="0"
                          step="50"
                          value={data.projected_sales || ""}
                          onChange={(e) => handleDataChange(hour, 'projected_sales', e.target.value)}
                          className="h-8 pl-6 text-sm"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max="50"
                      value={data.min_staff || ""}
                      onChange={(e) => handleDataChange(hour, 'min_staff', e.target.value)}
                      className="h-8 w-14 text-center"
                      placeholder="0"
                    />
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg border border-primary/20">
              <span className="text-sm font-medium">Totals:</span>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  ${totals.totalSales.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {totals.totalStaff} staff-hrs
                </span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

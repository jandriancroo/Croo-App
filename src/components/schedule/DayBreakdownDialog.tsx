import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, subWeeks } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { formatTime12Hour } from "@/lib/utils";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { Sparkles, Loader2, User, Printer } from "lucide-react";
import { getCachedSalesData, setCachedSalesData } from "@/utils/salesCache";
import { parseDateStringInTimezone, getTodayInTimezone } from "@/utils/timezoneUtils";
import { exportDayTimelineToPrint } from "@/utils/exportDayTimelinePrint";
import { normalizeBreaks } from "@/types/shiftBreak";
interface DayBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  scheduleId: string;
  // All shifts for the current week
  shifts: any[];
  // Profiles so we can resolve names and wages
  profiles: { id: string; full_name?: string | null; hourly_wage?: number | null; role?: string | null }[];
  // Location settings for business hours
  locationSettings?: { hours_open?: string; hours_close?: string; break_coverage_enabled?: boolean } | null;
}

export function DayBreakdownDialog({
  open,
  onOpenChange,
  date,
  scheduleId,
  shifts,
  profiles,
  locationSettings,
}: DayBreakdownDialogProps) {
  const dateStr = format(date, "yyyy-MM-dd");
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  
  // Sales data state
  const [salesData, setSalesData] = useState<{
    daily: number;
    hourly: Record<number, number>;
    isProjection: boolean;
  } | null>(null);
  const [isLoadingSales, setIsLoadingSales] = useState(false);
  
  // Fetch sales data for this day - use cache for past dates
  useEffect(() => {
    const fetchSalesData = async () => {
      if (!open || !currentLocation?.id) return;
      
      const todayStr = getTodayInTimezone(timezone);
      const isPast = dateStr < todayStr;
      const isTodayDate = dateStr === todayStr;
      const isFuture = dateStr > todayStr;
      
      // Check cache for past dates first
      if (isPast) {
        const cached = getCachedSalesData(currentLocation.id, dateStr, timezone);
        if (cached) {
          const hourlyMap: Record<number, number> = {};
          cached.hourly.forEach((item) => {
            const hourNum = parseInt(item.hour.split(':')[0]);
            hourlyMap[hourNum] = item.sales || 0;
          });
          
          setSalesData({
            daily: cached.daily,
            hourly: hourlyMap,
            isProjection: false
          });
          return;
        }
      }
      
      setIsLoadingSales(true);
      try {
        const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
          body: { locationId: currentLocation.id, targetDate: dateStr }
        });
        
        if (!error && data) {
          // Build hourly sales map from "hourly" array
          // For future dates, use "projected" field; for past/today use "sales"
          const hourlyMap: Record<number, number> = {};
          if (data.hourly && Array.isArray(data.hourly)) {
            data.hourly.forEach((item: { hour: string; sales: number; projected?: number }) => {
              const hourNum = parseInt(item.hour.split(':')[0]);
              // Use projected for future dates, actual sales for past/today
              hourlyMap[hourNum] = isFuture ? (item.projected || 0) : (item.sales || 0);
            });
          }
          
          const dailyProjection = isFuture 
            ? (data.projections?.todayProjected || 0)
            : (data.daily || 0);
          
          // Cache past data for future use
          if (isPast && data.daily > 0) {
            setCachedSalesData(currentLocation.id, dateStr, {
              daily: data.daily,
              hourly: data.hourly || [],
              guestCount: data.guestCount || { daily: 0 }
            }, timezone);
          }
          
          setSalesData({
            daily: dailyProjection,
            hourly: hourlyMap,
            isProjection: isFuture
          });
        }
      } catch (err) {
        console.error('Failed to fetch sales data:', err);
      } finally {
        setIsLoadingSales(false);
      }
    };
    
    fetchSalesData();
  }, [open, currentLocation?.id, dateStr]);
  
  // Calculate hourly projections for future dates based on historical patterns
  const calculateHourlyProjections = async (
    locationId: string,
    targetDate: Date,
    dailyProjection: number
  ): Promise<Record<number, number>> => {
    // Get the last 4 same-day-of-week dates
    const sameDayDates: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const pastDate = subWeeks(targetDate, i);
      sameDayDates.push(format(pastDate, 'yyyy-MM-dd'));
    }
    
    // Query sales_cache for historical hourly data
    const { data: historicalData } = await supabase
      .from('sales_cache')
      .select('sale_date, hourly_data')
      .eq('location_id', locationId)
      .in('sale_date', sameDayDates);
    
    if (!historicalData || historicalData.length === 0) {
      return {};
    }
    
    // Aggregate hourly percentages across all historical dates
    const hourlyTotals: Record<number, number[]> = {};
    
    historicalData.forEach((day) => {
      if (!day.hourly_data) return;
      
      // Calculate daily total for this historical day
      const hourlyData = day.hourly_data as { hour: string; sales: number }[];
      const dayTotal = hourlyData.reduce((sum, h) => sum + (h.sales || 0), 0);
      
      if (dayTotal <= 0) return;
      
      // Calculate percentage for each hour
      hourlyData.forEach((h) => {
        const hourNum = parseInt(h.hour.split(':')[0]);
        const percentage = (h.sales || 0) / dayTotal;
        
        if (!hourlyTotals[hourNum]) {
          hourlyTotals[hourNum] = [];
        }
        hourlyTotals[hourNum].push(percentage);
      });
    });
    
    // Calculate average percentage for each hour and apply to daily projection
    const hourlyProjections: Record<number, number> = {};
    
    Object.entries(hourlyTotals).forEach(([hour, percentages]) => {
      const avgPercentage = percentages.reduce((a, b) => a + b, 0) / percentages.length;
      hourlyProjections[parseInt(hour)] = dailyProjection * avgPercentage;
    });
    
    return hourlyProjections;
  };

  // Use in-memory shifts from the Schedule page so we always match what the grid shows
  const dayShifts = (shifts || []).filter(
    (shift) => shift.shift_date === dateStr && shift.schedule_id === scheduleId
  );

  const getProfileForShift = (shift: any) => profiles.find((p) => p.id === shift.user_id) || null;

  // Get shift color - match logic from ShiftCard.tsx
  const getShiftColor = (shift: any) => {
    return shift.template?.color || shift.color || "#ef4444";
  };


  // Sort shifts by start time
  const sortedDayShifts = [...dayShifts].sort((a, b) => {
    const aTime = a.start_time.split(":").map(Number);
    const bTime = b.start_time.split(":").map(Number);
    const aMinutes = aTime[0] * 60 + aTime[1];
    const bMinutes = bTime[0] * 60 + bTime[1];
    return aMinutes - bMinutes;
  });

  // Get earliest and latest hours for timeline based on business hours
  const getTimelineBounds = () => {
    // Use location business hours if available
    let earliest = 6; // Default 6 AM
    let latest = 22;  // Default 10 PM
    
    if (locationSettings?.hours_open) {
      const [openHour] = locationSettings.hours_open.split(":").map(Number);
      earliest = openHour;
    }
    if (locationSettings?.hours_close) {
      const [closeHour] = locationSettings.hours_close.split(":").map(Number);
      latest = closeHour;
    }
    
    // Also include any shifts that extend beyond business hours
    dayShifts.forEach((shift: any) => {
      if (shift.is_time_off) return;
      const [startHour] = shift.start_time.split(":").map(Number);
      const [endHour] = shift.end_time.split(":").map(Number);
      // Handle midnight crossover for bounds (e.g., 18:00-00:00 should extend to 24)
      const effectiveEnd = endHour < startHour ? 24 : endHour;
      earliest = Math.min(earliest, startHour);
      latest = Math.max(latest, effectiveEnd);
    });

    return { earliest, latest };
  };

  const { earliest, latest } = getTimelineBounds();
  const timelineHours = Array.from({ length: latest - earliest }, (_, i) => earliest + i);

  // Calculate hourly breakdown
  const calculateHourlyBreakdown = () => {
    const hourlyData: Record<number, { hours: number; cost: number; count: number }> = {};

    dayShifts.forEach((shift: any) => {
      if (shift.is_time_off) return;

      const [startHour, startMin] = shift.start_time.split(":").map(Number);
      const [endHour, endMin] = shift.end_time.split(":").map(Number);

      const startTime = startHour + startMin / 60;
      let endTime = endHour + endMin / 60;
      // Handle midnight crossover (e.g., 6pm-12am = 18:00-00:00)
      if (endTime < startTime) {
        endTime += 24;
      }
      const totalHours = endTime - startTime;
      const hasBreak = totalHours > 5;
      const workedHours = hasBreak ? totalHours - 0.5 : totalHours;

      const profile = getProfileForShift(shift);
      const wage = profile?.hourly_wage ?? 15;

      // Fill in each hour this shift covers
      for (let hour = Math.floor(startTime); hour < Math.ceil(endTime); hour++) {
        if (!hourlyData[hour]) {
          hourlyData[hour] = { hours: 0, cost: 0, count: 0 };
        }

        // Calculate fraction of hour worked
        const hourStart = Math.max(hour, startTime);
        const hourEnd = Math.min(hour + 1, endTime);
        const hoursThisSlot = hourEnd - hourStart;

        hourlyData[hour].hours += hoursThisSlot;
        hourlyData[hour].cost += hoursThisSlot * wage;
        hourlyData[hour].count += 1;
      }
    });

    return hourlyData;
  };

  const hourlyBreakdown = calculateHourlyBreakdown();

  // Calculate totals
  const totalHours = dayShifts.reduce((sum: number, shift: any) => {
    if (shift.is_time_off) return sum;
    const [startHour, startMin] = shift.start_time.split(":").map(Number);
    const [endHour, endMin] = shift.end_time.split(":").map(Number);
    let hours = endHour + endMin / 60 - (startHour + startMin / 60);
    // Handle midnight crossover (e.g., 6pm-12am)
    if (hours < 0) hours += 24;
    return sum + (hours > 5 ? hours - 0.5 : hours);
  }, 0);

  const totalCost = dayShifts.reduce((sum: number, shift: any) => {
    if (shift.is_time_off) return sum;
    const [startHour, startMin] = shift.start_time.split(":").map(Number);
    const [endHour, endMin] = shift.end_time.split(":").map(Number);
    let hours = endHour + endMin / 60 - (startHour + startMin / 60);
    // Handle midnight crossover (e.g., 6pm-12am)
    if (hours < 0) hours += 24;
    const workedHours = hours > 5 ? hours - 0.5 : hours;
    const profile = getProfileForShift(shift);
    const wage = profile?.hourly_wage ?? 15;
    return sum + workedHours * wage;
  }, 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const coverageBlocksByUser = new Map<string, Array<{ coveredUserName: string; start_time: string; end_time: string }>>();
  dayShifts.forEach((coveredShift: any) => {
    const coveredProfile = getProfileForShift(coveredShift);
    normalizeBreaks(coveredShift.breaks).forEach((br) => {
      if (!br.covered_by_user_id) return;
      const blocks = coverageBlocksByUser.get(br.covered_by_user_id) || [];
      blocks.push({
        coveredUserName: coveredProfile?.full_name || "Unknown",
        start_time: br.start_time,
        end_time: br.end_time,
      });
      coverageBlocksByUser.set(br.covered_by_user_id, blocks);
    });
  });

  const handlePrintDayTimeline = () => {
    exportDayTimelineToPrint({
      locationName: currentLocation?.name || "Location",
      date,
      profiles: profiles.map((p) => ({
        id: p.id,
        full_name: p.full_name || "Unknown",
        role: p.role,
      })),
      shifts: dayShifts
        .filter((shift: any) => !shift.is_time_off)
        .map((shift: any) => ({
          id: shift.id,
          user_id: shift.user_id,
          start_time: shift.start_time,
          end_time: shift.end_time,
          template_name: shift.template?.template_name ?? null,
          template_color: shift.template?.color ?? shift.color ?? null,
          position: shift.template?.template_name ?? null,
          breaks: shift.breaks,
        })),
      breakCoverageEnabled: !!locationSettings?.break_coverage_enabled,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-xl">
                {format(date, "EEEE, MMMM d, yyyy")}
              </DialogTitle>
              <DialogDescription>
                Visual timeline and labor breakdown for the selected day.
              </DialogDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handlePrintDayTimeline} className="gap-2 shrink-0">
              <Printer className="h-4 w-4" />
              Print / PDF
            </Button>
          </div>
        </DialogHeader>

        {dayShifts.length === 0 ? (
          <div className="space-y-4">
            <div className="text-center py-8 text-muted-foreground">
              No shifts scheduled for this day
            </div>
            {/* Still show sales data even with no shifts */}
            {salesData && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted p-2 flex items-center gap-2">
                  <h3 className="font-semibold text-sm">Daily Sales</h3>
                  {salesData.isProjection && (
                    <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Croo AI
                    </Badge>
                  )}
                </div>
                <div className="p-4">
                  <div className="text-3xl font-bold text-primary">
                    {formatCurrency(salesData.daily)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Visual Timeline */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted p-2">
                <h3 className="font-semibold text-sm">Visual Timeline</h3>
              </div>
              <div className="p-4 overflow-x-auto">
                <div className="min-w-[600px]">
                  {/* Labor hours per hour */}
                  <div className="flex mb-1">
                    <div className="w-32 flex-shrink-0"></div>
                    <div className="flex-1 flex">
                      {timelineHours.map((hour) => {
                        const data = hourlyBreakdown[hour] || { hours: 0, cost: 0, count: 0 };
                        return (
                          <div
                            key={hour}
                            className="flex-1 flex items-center justify-center gap-0.5 text-[10px] font-semibold text-primary"
                          >
                            {data.hours > 0 && (
                              <>
                                <User className="h-2.5 w-2.5" />
                                {data.hours.toFixed(1)}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  
                  {/* Hour labels */}
                  <div className="flex mb-2">
                    <div className="w-32 flex-shrink-0"></div>
                    <div className="flex-1 flex">
                      {timelineHours.map((hour) => {
                        const hour12 = hour % 12 || 12;
                        const period = hour < 12 ? "AM" : "PM";
                        return (
                          <div
                            key={hour}
                            className="flex-1 text-center text-xs text-muted-foreground border-l border-border first:border-l-0"
                          >
                            {hour12}{period}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Shift bars with vertical grid lines */}
                  <div className="space-y-2 relative">
                    {/* Vertical grid lines overlay */}
                    <div className="absolute inset-0 flex pointer-events-none" style={{ marginLeft: '128px' }}>
                      {timelineHours.map((hour, index) => (
                        <div
                          key={hour}
                          className={`flex-1 ${index > 0 ? 'border-l border-border/40' : ''}`}
                        />
                      ))}
                    </div>
                    
                    {sortedDayShifts
                      .filter((shift: any) => !shift.is_time_off)
                      .map((shift: any) => {
                        const profile = getProfileForShift(shift);
                        const [startHour, startMin] = shift.start_time.split(":").map(Number);
                        const [endHour, endMin] = shift.end_time.split(":").map(Number);
                        
                        const startTime = startHour + startMin / 60;
                        let endTime = endHour + endMin / 60;
                        // Handle midnight crossover (e.g., 6pm-12am)
                        if (endTime < startTime) {
                          endTime += 24;
                        }
                        
                        // Calculate position and width as percentage
                        const totalRange = latest - earliest;
                        const leftPercent = ((startTime - earliest) / totalRange) * 100;
                        const widthPercent = ((endTime - startTime) / totalRange) * 100;

                        const shiftBreaks = normalizeBreaks(shift.breaks);
                        const myCoverageBlocks = coverageBlocksByUser.get(shift.user_id) || [];
                        const hasDetails = shiftBreaks.length > 0 || myCoverageBlocks.length > 0;
                        return (
                          <div key={shift.id} className="flex items-center relative z-10">
                            <div className="w-32 flex-shrink-0 text-sm font-medium truncate pr-2">
                              {profile?.full_name ?? (shift.user_id ? "Hidden" : "Unassigned")}
                            </div>
                            <div className="flex-1 relative h-8 bg-muted/30 rounded">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="absolute h-full rounded flex items-center justify-center text-xs font-medium text-white shadow-sm hover:brightness-110 transition-all text-left"
                                    style={{
                                      left: `${leftPercent}%`,
                                      width: `${widthPercent}%`,
                                      backgroundColor: getShiftColor(shift),
                                    }}
                                  >
                                    <span className="truncate px-1">
                                      {formatTime12Hour(shift.start_time)} - {formatTime12Hour(shift.end_time)}
                                    </span>
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-72 text-xs">
                                  <div className="font-semibold text-sm mb-1">{profile?.full_name ?? 'Unassigned'}</div>
                                  <div className="text-muted-foreground mb-2">
                                    Shift {formatTime12Hour(shift.start_time)} – {formatTime12Hour(shift.end_time)}
                                  </div>
                                  {shiftBreaks.length === 0 && myCoverageBlocks.length === 0 ? (
                                    <div className="text-muted-foreground italic">No breaks on this shift.</div>
                                  ) : (
                                    <div className="space-y-2">
                                      {shiftBreaks.length > 0 && (
                                        <div>
                                          <div className="font-semibold mb-1">Breaks</div>
                                          {shiftBreaks.map((br: any, i: number) => {
                                            const coverer = br.covered_by_user_id
                                              ? profiles.find((p) => p.id === br.covered_by_user_id)
                                              : null;
                                            return (
                                              <div key={br.id ?? i} className="flex items-center justify-between gap-2 py-0.5">
                                                <span>{formatTime12Hour(br.start_time)} – {formatTime12Hour(br.end_time)}</span>
                                                <span className="text-muted-foreground">
                                                  {coverer ? `Covered by ${coverer.full_name}` : 'No coverage'}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                      {myCoverageBlocks.length > 0 && (
                                        <div>
                                          <div className="font-semibold mb-1">Covering for others</div>
                                          {myCoverageBlocks.map((c, i) => (
                                            <div key={i} className="flex items-center justify-between gap-2 py-0.5">
                                              <span>{formatTime12Hour(c.start_time)} – {formatTime12Hour(c.end_time)}</span>
                                              <span className="text-muted-foreground">{c.coveredUserName}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </PopoverContent>
                              </Popover>
                              {/* Break overlays — solid shaded amber on the person on break */}
                              {shiftBreaks.map((br: any, i: number) => {
                                if (!br?.start_time || !br?.end_time) return null;
                                const [bsH, bsM] = String(br.start_time).split(":").map(Number);
                                const [beH, beM] = String(br.end_time).split(":").map(Number);
                                const bs = bsH + bsM / 60;
                                let be = beH + beM / 60;
                                if (be < bs) be += 24;
                                const bLeft = ((bs - earliest) / totalRange) * 100;
                                const bWidth = ((be - bs) / totalRange) * 100;
                                return (
                                  <div
                                    key={br.id ?? i}
                                    title={`Break ${formatTime12Hour(br.start_time)} - ${formatTime12Hour(br.end_time)}`}
                                    className="absolute top-0 h-full rounded border border-amber-600/60 pointer-events-none opacity-80"
                                    style={{
                                      left: `${bLeft}%`,
                                      width: `${bWidth}%`,
                                      zIndex: 2,
                                      backgroundImage:
                                        'repeating-linear-gradient(45deg, rgba(217,119,6,0.55) 0 4px, rgba(255,237,213,0.85) 4px 8px)',
                                    }}
                                  />
                                );
                              })}
                              {/* Coverage overlays — solid block showing WHO they are covering */}
                              {myCoverageBlocks.map((coverage, i) => {
                                const [csH, csM] = String(coverage.start_time).split(":").map(Number);
                                const [ceH, ceM] = String(coverage.end_time).split(":").map(Number);
                                const cs = csH + csM / 60;
                                let ce = ceH + ceM / 60;
                                if (ce < cs) ce += 24;
                                const cLeft = ((cs - earliest) / totalRange) * 100;
                                const cWidth = ((ce - cs) / totalRange) * 100;
                                return (
                                  <div
                                    key={`${shift.id}-coverage-${i}`}
                                    title={`Covering ${coverage.coveredUserName} ${formatTime12Hour(coverage.start_time)} - ${formatTime12Hour(coverage.end_time)}`}
                                    className="absolute top-0 h-full rounded border border-amber-700 bg-amber-500 flex items-center justify-center text-[10px] font-bold text-white shadow-sm pointer-events-none"
                                    style={{ left: `${cLeft}%`, width: `${cWidth}%`, zIndex: 3 }}
                                  >
                                    <span className="truncate px-1">{coverage.coveredUserName.split(' ')[0]}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </div>

            {/* Sales Summary */}
            {salesData && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted p-2 flex items-center gap-2">
                  <h3 className="font-semibold text-sm">Daily Sales</h3>
                  {salesData.isProjection && (
                    <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Croo AI
                    </Badge>
                  )}
                  {isLoadingSales && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
                <div className="p-4">
                  <div className="text-3xl font-bold text-primary">
                    {formatCurrency(salesData.daily)}
                  </div>
                  {totalCost > 0 && salesData.daily > 0 && (
                    <div className="text-sm text-muted-foreground mt-1">
                      Labor %: <span className={`font-semibold ${(totalCost / salesData.daily * 100) <= 30 ? 'text-green-600' : (totalCost / salesData.daily * 100) <= 35 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {(totalCost / salesData.daily * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Hourly Breakdown Table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted p-2 flex items-center gap-2">
                <h3 className="font-semibold text-sm">Hourly Breakdown</h3>
                {salesData?.isProjection && <Sparkles className="h-3 w-3 text-primary" />}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Hour</th>
                      <th className="p-2 text-center font-medium">Staff</th>
                      <th className="p-2 text-right font-medium">Hours</th>
                      <th className="p-2 text-right font-medium">Labor $</th>
                      <th className="p-2 text-right font-medium">Sales</th>
                      <th className="p-2 text-right font-medium">Labor %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timelineHours.map((hourNum) => {
                      const data = hourlyBreakdown[hourNum] || { hours: 0, cost: 0, count: 0 };
                      const hour = hourNum % 12 === 0 ? 12 : hourNum % 12;
                      const period = hourNum < 12 ? "AM" : "PM";
                      const hourlySales = salesData?.hourly[hourNum] || 0;
                      const laborPercent = hourlySales > 0 ? (data.cost / hourlySales) * 100 : 0;

                      return (
                        <tr key={hourNum} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-medium">
                            {hour} {period}
                          </td>
                          <td className="p-2 text-center">
                            <Badge variant="outline" className="text-[10px]">
                              {data.count}
                            </Badge>
                          </td>
                          <td className="p-2 text-right">
                            {data.hours.toFixed(2)}
                          </td>
                          <td className="p-2 text-right font-medium">
                            {formatCurrency(data.cost)}
                          </td>
                          <td className="p-2 text-right">
                            {hourlySales > 0 ? formatCurrency(hourlySales) : '-'}
                          </td>
                          <td className={`p-2 text-right font-medium ${laborPercent > 0 && laborPercent <= 30 ? 'text-green-600' : laborPercent > 30 && laborPercent <= 35 ? 'text-yellow-600' : laborPercent > 35 ? 'text-red-600' : ''}`}>
                            {hourlySales > 0 ? `${laborPercent.toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-muted font-semibold">
                      <td className="p-2">Total</td>
                      <td className="p-2 text-center">
                        {dayShifts.filter((s: any) => !s.is_time_off).length}
                      </td>
                      <td className="p-2 text-right">{totalHours.toFixed(2)} Hrs</td>
                      <td className="p-2 text-right">{formatCurrency(totalCost)}</td>
                      <td className="p-2 text-right">{salesData?.daily ? formatCurrency(salesData.daily) : '-'}</td>
                      <td className={`p-2 text-right ${salesData?.daily && (totalCost / salesData.daily * 100) <= 30 ? 'text-green-600' : salesData?.daily && (totalCost / salesData.daily * 100) <= 35 ? 'text-yellow-600' : salesData?.daily ? 'text-red-600' : ''}`}>
                        {salesData?.daily ? `${(totalCost / salesData.daily * 100).toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Employee Shifts List */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted p-2">
                <h3 className="font-semibold text-sm">Employee Shifts</h3>
              </div>
              <div className="divide-y">
                {sortedDayShifts.map((shift: any) => {
                  const [startHour, startMin] = shift.start_time.split(":").map(Number);
                  const [endHour, endMin] = shift.end_time.split(":").map(Number);
                  const startTime = startHour + startMin / 60;
                  let endTime = endHour + endMin / 60;
                  // Handle midnight crossover (e.g., 6pm-12am)
                  if (endTime < startTime) {
                    endTime += 24;
                  }
                  const hours = endTime - startTime;
                  const workedHours = hours > 5 ? hours - 0.5 : hours;
                  const profile = getProfileForShift(shift);
                  const wage = profile?.hourly_wage ?? 15;
                  const cost = workedHours * wage;

                  return (
                    <div
                      key={shift.id}
                      className="flex items-center justify-between p-3 hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getShiftColor(shift) }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {profile?.full_name || "Unassigned"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatTime12Hour(shift.start_time)} - {formatTime12Hour(shift.end_time)}
                            {shift.is_time_off && (
                              <Badge
                                variant="secondary"
                                className="ml-2 text-[10px]"
                              >
                                Time Off
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      {!shift.is_time_off && (
                        <div className="text-right ml-4">
                          <div className="font-semibold text-sm">
                            {formatCurrency(cost)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {workedHours.toFixed(2)} hrs × {formatCurrency(wage)}/hr
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {dayShifts.filter((s: any) => !s.is_time_off).length}
                </div>
                <div className="text-xs text-muted-foreground">
                  Employees Scheduled
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{totalHours.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">Total Hours</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {formatCurrency(totalCost)}
                </div>
                <div className="text-xs text-muted-foreground">Total Labor Cost</div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

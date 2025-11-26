import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { formatTime12Hour } from "@/lib/utils";

interface DayBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  scheduleId: string;
  // All shifts for the current week
  shifts: any[];
  // Profiles so we can resolve names and wages
  profiles: { id: string; full_name?: string | null; hourly_wage?: number | null }[];
}

export function DayBreakdownDialog({
  open,
  onOpenChange,
  date,
  scheduleId,
  shifts,
  profiles,
}: DayBreakdownDialogProps) {
  const dateStr = format(date, "yyyy-MM-dd");

  // Use in-memory shifts from the Schedule page so we always match what the grid shows
  const dayShifts = (shifts || []).filter(
    (shift) => shift.shift_date === dateStr && shift.schedule_id === scheduleId
  );

  const getProfileForShift = (shift: any) => profiles.find((p) => p.id === shift.user_id) || null;

  // Get shift template color
  const getShiftColor = (shift: any) => {
    // Use template color if available
    if (shift.template?.color) {
      return shift.template.color;
    }
    // Fallback to a default color
    return "hsl(var(--primary))";
  };


  // Sort shifts by start time
  const sortedDayShifts = [...dayShifts].sort((a, b) => {
    const aTime = a.start_time.split(":").map(Number);
    const bTime = b.start_time.split(":").map(Number);
    const aMinutes = aTime[0] * 60 + aTime[1];
    const bMinutes = bTime[0] * 60 + bTime[1];
    return aMinutes - bMinutes;
  });

  // Get earliest and latest hours for timeline
  const getTimelineBounds = () => {
    let earliest = 24;
    let latest = 0;

    dayShifts.forEach((shift: any) => {
      if (shift.is_time_off) return;
      const [startHour] = shift.start_time.split(":").map(Number);
      const [endHour] = shift.end_time.split(":").map(Number);
      earliest = Math.min(earliest, startHour);
      latest = Math.max(latest, endHour);
    });

    // Default to 6 AM to 10 PM if no shifts
    if (earliest === 24) earliest = 6;
    if (latest === 0) latest = 22;

    // Add padding
    earliest = Math.max(0, earliest - 1);
    latest = Math.min(24, latest + 1);

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
      const endTime = endHour + endMin / 60;
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
    const hours = endHour + endMin / 60 - (startHour + startMin / 60);
    return sum + (hours > 5 ? hours - 0.5 : hours);
  }, 0);

  const totalCost = dayShifts.reduce((sum: number, shift: any) => {
    if (shift.is_time_off) return sum;
    const [startHour, startMin] = shift.start_time.split(":").map(Number);
    const [endHour, endMin] = shift.end_time.split(":").map(Number);
    const hours = endHour + endMin / 60 - (startHour + startMin / 60);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {format(date, "EEEE, MMMM d, yyyy")}
          </DialogTitle>
          <DialogDescription>
            Visual timeline and labor breakdown for the selected day.
          </DialogDescription>
        </DialogHeader>

        {dayShifts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No shifts scheduled for this day
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

                  {/* Shift bars */}
                  <div className="space-y-2">
                    {sortedDayShifts
                      .filter((shift: any) => !shift.is_time_off)
                      .map((shift: any) => {
                        const profile = getProfileForShift(shift);
                        const [startHour, startMin] = shift.start_time.split(":").map(Number);
                        const [endHour, endMin] = shift.end_time.split(":").map(Number);
                        
                        const startTime = startHour + startMin / 60;
                        const endTime = endHour + endMin / 60;
                        
                        // Calculate position and width as percentage
                        const totalRange = latest - earliest;
                        const leftPercent = ((startTime - earliest) / totalRange) * 100;
                        const widthPercent = ((endTime - startTime) / totalRange) * 100;

                        return (
                          <div key={shift.id} className="flex items-center">
                            <div className="w-32 flex-shrink-0 text-sm font-medium truncate pr-2">
                              {profile?.full_name || "Unassigned"}
                            </div>
                            <div className="flex-1 relative h-8 bg-muted/30 rounded">
                              <div
                                className="absolute h-full rounded flex items-center justify-center text-xs font-medium text-white shadow-sm"
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${widthPercent}%`,
                                  backgroundColor: getShiftColor(shift),
                                }}
                              >
                                <span className="truncate px-1">
                                  {formatTime12Hour(shift.start_time)} - {formatTime12Hour(shift.end_time)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </div>

            {/* Hourly Breakdown Table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted p-2">
                <h3 className="font-semibold text-sm">Hourly Labor Breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Hour</th>
                      <th className="p-2 text-center font-medium">Staff</th>
                      <th className="p-2 text-right font-medium">Hours</th>
                      <th className="p-2 text-right font-medium">Labor $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(hourlyBreakdown)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([hourStr, data]) => {
                        const hourNum = Number(hourStr);
                        const hour = hourNum % 12 === 0 ? 12 : hourNum % 12;
                        const period = hourNum < 12 ? "AM" : "PM";

                        return (
                          <tr key={hourStr} className="border-b hover:bg-muted/50">
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
                  const hours = endHour + endMin / 60 - (startHour + startMin / 60);
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

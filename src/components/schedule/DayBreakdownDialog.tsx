import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

interface DayBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  scheduleId: string;
}

export function DayBreakdownDialog({ open, onOpenChange, date, scheduleId }: DayBreakdownDialogProps) {
  const { data: dayShifts = [], isLoading } = useQuery({
    queryKey: ['day-breakdown', scheduleId, date.toISOString()],
    queryFn: async () => {
      const dateStr = date.toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('scheduled_shifts')
        .select(`
          *,
          profiles!scheduled_shifts_user_id_fkey(full_name, hourly_wage)
        `)
        .eq('schedule_id', scheduleId)
        .eq('shift_date', dateStr)
        .order('start_time');

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Calculate hourly breakdown
  const calculateHourlyBreakdown = () => {
    const hourlyData: Record<number, { hours: number; cost: number; count: number }> = {};

    dayShifts.forEach((shift: any) => {
      if (shift.is_time_off) return;

      const [startHour, startMin] = shift.start_time.split(':').map(Number);
      const [endHour, endMin] = shift.end_time.split(':').map(Number);
      
      const startTime = startHour + startMin / 60;
      const endTime = endHour + endMin / 60;
      const totalHours = endTime - startTime;
      const hasBreak = totalHours > 5;
      const workedHours = hasBreak ? totalHours - 0.5 : totalHours;
      
      const wage = shift.profiles?.hourly_wage || 15;

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
    const [startHour, startMin] = shift.start_time.split(':').map(Number);
    const [endHour, endMin] = shift.end_time.split(':').map(Number);
    const hours = (endHour + endMin / 60) - (startHour + startMin / 60);
    return sum + (hours > 5 ? hours - 0.5 : hours);
  }, 0);

  const totalCost = dayShifts.reduce((sum: number, shift: any) => {
    if (shift.is_time_off) return sum;
    const [startHour, startMin] = shift.start_time.split(':').map(Number);
    const [endHour, endMin] = shift.end_time.split(':').map(Number);
    const hours = (endHour + endMin / 60) - (startHour + startMin / 60);
    const workedHours = hours > 5 ? hours - 0.5 : hours;
    const wage = shift.profiles?.hourly_wage || 15;
    return sum + (workedHours * wage);
  }, 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatHours = (hours: number) => {
    if (hours === 0) return '0 Hrs';
    return `${hours.toFixed(1)} Hrs`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{format(date, 'EEEE, MMMM d, yyyy')} - Labor Breakdown</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <div className="space-y-6">
            {/* Total Summary */}
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div>
                <div className="text-2xl font-bold">{formatHours(totalHours)}</div>
                <div className="text-sm text-muted-foreground">Total Hours</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{formatCurrency(totalCost)}</div>
                <div className="text-sm text-muted-foreground">Total Labor Cost</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{dayShifts.filter((s: any) => !s.is_time_off).length}</div>
                <div className="text-sm text-muted-foreground">Scheduled Shifts</div>
              </div>
            </div>

            {/* Hourly Breakdown */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Hourly Labor Breakdown</h3>
              <div className="grid grid-cols-8 gap-2">
                {Array.from({ length: 24 }, (_, i) => {
                  const hourData = hourlyBreakdown[i];
                  const hour = i % 12 === 0 ? 12 : i % 12;
                  const period = i < 12 ? 'AM' : 'PM';
                  
                  return (
                    <div 
                      key={i} 
                      className={`p-2 text-center rounded border ${
                        hourData && hourData.hours > 0 
                          ? 'bg-primary/10 border-primary' 
                          : 'bg-muted border-border'
                      }`}
                    >
                      <div className="text-xs font-medium">{hour}{period}</div>
                      {hourData && hourData.hours > 0 ? (
                        <>
                          <div className="text-xs mt-1">
                            <Badge variant="secondary" className="text-[10px] px-1">
                              {hourData.count}
                            </Badge>
                          </div>
                          <div className="text-xs font-semibold mt-1">
                            {formatHours(hourData.hours)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatCurrency(hourData.cost)}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground mt-1">-</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Shift List */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Scheduled Shifts</h3>
              <div className="space-y-2">
                {dayShifts.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">No shifts scheduled</p>
                ) : (
                  dayShifts.map((shift: any) => {
                    const [startHour, startMin] = shift.start_time.split(':').map(Number);
                    const [endHour, endMin] = shift.end_time.split(':').map(Number);
                    const hours = (endHour + endMin / 60) - (startHour + startMin / 60);
                    const workedHours = hours > 5 ? hours - 0.5 : hours;
                    const wage = shift.profiles?.hourly_wage || 15;
                    const cost = workedHours * wage;

                    return (
                      <div 
                        key={shift.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{shift.profiles?.full_name || 'Unassigned'}</div>
                          <div className="text-sm text-muted-foreground">
                            {shift.start_time} - {shift.end_time}
                            {shift.is_time_off && <Badge variant="secondary" className="ml-2">Time Off</Badge>}
                          </div>
                        </div>
                        {!shift.is_time_off && (
                          <div className="text-right">
                            <div className="font-semibold">{formatCurrency(cost)}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatHours(workedHours)} @ {formatCurrency(wage)}/hr
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

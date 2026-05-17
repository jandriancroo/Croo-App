import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getDateDayOfWeekInTimezone } from '@/utils/dateUtils';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  anchorDate: Date;
  range: 'week' | 'month';
}

interface DayCell {
  dateStr: string;
  date: Date;
  inRange: boolean;
  completionPct: number | null; // null = no checklists scheduled
  completedChecklists: number;
  totalChecklists: number;
}

export function ChecklistHeatmap({ anchorDate, range }: Props) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const { timezone, getBusinessDayRangeInTimezone, closeTime, loading: tzLoading } = useLocationTimezone();

  // Compute date range
  const { startDate, endDate, gridDays } = useMemo(() => {
    if (range === 'week') {
      const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
      const end = addDays(start, 6);
      return {
        startDate: start,
        endDate: end,
        gridDays: eachDayOfInterval({ start, end }).map(d => ({ date: d, inRange: true })),
      };
    } else {
      const monthStart = startOfMonth(anchorDate);
      const monthEnd = endOfMonth(anchorDate);
      const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
      const gridEnd = addDays(gridStart, 41);
      const allDays = eachDayOfInterval({ start: gridStart, end: gridEnd });
      return {
        startDate: monthStart,
        endDate: monthEnd,
        gridDays: allDays.map(d => ({
          date: d,
          inRange: d >= monthStart && d <= monthEnd,
        })),
      };
    }
  }, [anchorDate, range]);

  const rangeKey = `${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}`;

  const { data: heatmapData, isLoading } = useQuery({
    queryKey: ['checklist-heatmap', currentLocation?.id, rangeKey, closeTime, timezone],
    staleTime: 5 * 60 * 1000,
    enabled: !!user && !!currentLocation?.id && !tzLoading,
    queryFn: async (): Promise<Record<string, { completedChecklists: number; totalChecklists: number; pct: number | null }>> => {
      if (!currentLocation?.id) return {};

      // Fetch all active checklists with items
      const { data: checklists } = await supabase
        .from('checklists')
        .select(`
          id,
          template_type,
          frequency,
          visible_days_before_month_end,
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true)
        .eq('location_id', currentLocation.id);

      if (!checklists || checklists.length === 0) return {};

      const checklistIds = checklists.map(c => c.id);

      // Wide window covering all business-day ranges in grid
      const windowStart = getBusinessDayRangeInTimezone(format(startDate, 'yyyy-MM-dd')).start;
      const windowEnd = getBusinessDayRangeInTimezone(format(endDate, 'yyyy-MM-dd')).end;

      const { data: responses } = await supabase
        .from('checklist_responses')
        .select(`
          item_id,
          created_at,
          checklist_submissions!inner(checklist_id, location_id)
        `)
        .in('checklist_submissions.checklist_id', checklistIds)
        .eq('checklist_submissions.location_id', currentLocation.id)
        .gte('created_at', windowStart.toISOString())
        .lte('created_at', windowEnd.toISOString())
        .not('completed_by', 'is', null);

      const result: Record<string, { completedChecklists: number; totalChecklists: number; pct: number | null }> = {};

      // For each day in range compute per-checklist completion
      const daysToCompute = eachDayOfInterval({ start: startDate, end: endDate });

      for (const day of daysToCompute) {
        const dateStr = format(day, 'yyyy-MM-dd');
        const { start: dayStart, end: dayEnd } = getBusinessDayRangeInTimezone(dateStr);
        const currentDay = getDateDayOfWeekInTimezone(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0), timezone);

        // Filter applicable checklists for this day
        const applicable = checklists.filter(cl => {
          const isMonthly = cl.frequency === 'monthly';
          if (isMonthly) {
            if (cl.visible_days_before_month_end) {
              const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0);
              const daysUntilEnd = lastDay.getDate() - day.getDate();
              if (daysUntilEnd >= cl.visible_days_before_month_end) return false;
            }
            return (cl.checklist_items?.length || 0) > 0;
          }
          if (cl.template_type === 'dynamic') {
            const todayItems = cl.checklist_items?.filter((it: any) => it.days_of_week?.includes(currentDay));
            return (todayItems?.length || 0) > 0;
          }
          return (cl.checklist_items?.length || 0) > 0;
        });

        if (applicable.length === 0) {
          result[dateStr] = { completedChecklists: 0, totalChecklists: 0, pct: null };
          continue;
        }

        let totalRate = 0;
        let completedFully = 0;
        for (const cl of applicable) {
          const isMonthly = cl.frequency === 'monthly';
          const periodStart = isMonthly
            ? new Date(day.getFullYear(), day.getMonth(), 1).toISOString()
            : dayStart.toISOString();
          const periodEnd = isMonthly
            ? new Date(day.getFullYear(), day.getMonth() + 1, 0, 23, 59, 59).toISOString()
            : dayEnd.toISOString();

          const itemIds = cl.template_type === 'dynamic'
            ? new Set(cl.checklist_items?.filter((it: any) => it.days_of_week?.includes(currentDay)).map((it: any) => it.id))
            : new Set(cl.checklist_items?.map((it: any) => it.id));
          const itemCount = itemIds.size;
          if (itemCount === 0) continue;

          const completed = new Set<string>();
          (responses || []).forEach((r: any) => {
            if ((r.checklist_submissions as any).checklist_id !== cl.id) return;
            if (r.created_at < periodStart || r.created_at > periodEnd) return;
            if (r.item_id && itemIds.has(r.item_id)) completed.add(r.item_id);
          });
          const rate = completed.size / itemCount;
          totalRate += rate;
          if (rate >= 1) completedFully += 1;
        }

        result[dateStr] = {
          completedChecklists: completedFully,
          totalChecklists: applicable.length,
          pct: Math.round((totalRate / applicable.length) * 100),
        };
      }

      return result;
    },
  });

  const cells: DayCell[] = gridDays.map(({ date, inRange }) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const d = heatmapData?.[dateStr];
    return {
      dateStr,
      date,
      inRange,
      completionPct: d ? d.pct : null,
      completedChecklists: d?.completedChecklists ?? 0,
      totalChecklists: d?.totalChecklists ?? 0,
    };
  });

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const getColor = (pct: number | null, inRange: boolean, isFuture: boolean) => {
    if (!inRange) return 'bg-muted/20';
    if (isFuture) return 'bg-muted/30';
    if (pct === null) return 'bg-muted/40';
    if (pct === 0) return 'bg-destructive/20';
    if (pct < 25) return 'bg-destructive/40';
    if (pct < 50) return 'bg-amber-500/40';
    if (pct < 75) return 'bg-amber-500/70';
    if (pct < 100) return 'bg-emerald-500/60';
    return 'bg-emerald-500';
  };

  const weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Compute summary (exclude future days)
  const summary = useMemo(() => {
    const inRangeCells = cells.filter(c => c.inRange && c.completionPct !== null && c.dateStr <= todayStr);
    if (inRangeCells.length === 0) return null;
    const avg = Math.round(inRangeCells.reduce((s, c) => s + (c.completionPct || 0), 0) / inRangeCells.length);
    const perfectDays = inRangeCells.filter(c => c.completionPct === 100).length;
    return { avg, perfectDays, total: inRangeCells.length };
  }, [cells, todayStr]);

  return (
    <Card>
      <CardContent className="py-4 px-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">
              {range === 'week'
                ? `Week of ${format(startDate, 'MMM d')}`
                : format(anchorDate, 'MMMM yyyy')}
            </h3>
            {summary && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary.avg}% avg · {summary.perfectDays}/{summary.total} perfect days
              </p>
            )}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Less</span>
            <div className="w-3 h-3 rounded-sm bg-destructive/20" />
            <div className="w-3 h-3 rounded-sm bg-amber-500/40" />
            <div className="w-3 h-3 rounded-sm bg-amber-500/70" />
            <div className="w-3 h-3 rounded-sm bg-emerald-500/60" />
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span className="text-[10px] text-muted-foreground">More</span>
          </div>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {weekdayLabels.map((d, i) => (
            <div key={i} className="text-[10px] text-center text-muted-foreground font-medium">{d}</div>
          ))}
        </div>

        {/* Heatmap grid */}
        <TooltipProvider delayDuration={100}>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map(cell => {
              const isToday = cell.dateStr === todayStr;
              const isFuture = cell.dateStr > todayStr;
              return (
                <Tooltip key={cell.dateStr}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'aspect-square rounded-md flex items-center justify-center text-[11px] font-medium transition-all cursor-default relative',
                        getColor(cell.completionPct, cell.inRange, isFuture),
                        !cell.inRange && 'opacity-30',
                        isFuture && 'opacity-50',
                        cell.inRange && !isFuture && 'hover:ring-2 hover:ring-primary/40',
                        isToday && 'ring-2 ring-primary',
                        !isFuture && cell.completionPct !== null && cell.completionPct >= 50 ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {format(cell.date, 'd')}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="text-xs">
                      <div className="font-semibold">{format(cell.date, 'EEE, MMM d')}</div>
                      {cell.completionPct === null ? (
                        <div className="text-muted-foreground">No checklists scheduled</div>
                      ) : (
                        <>
                          <div>{cell.completionPct}% completion</div>
                          <div className="text-muted-foreground">
                            {cell.completedChecklists}/{cell.totalChecklists} checklists complete
                          </div>
                        </>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        {isLoading && (
          <p className="text-xs text-muted-foreground mt-3 text-center">Loading completion data...</p>
        )}
      </CardContent>
    </Card>
  );
}

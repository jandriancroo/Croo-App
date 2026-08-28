import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getDateDayOfWeekInTimezone } from '@/utils/dateUtils';
import { getScorePeriodStart, isItemExpectedInPeriod } from '@/utils/checklistArchivePeriod';
import { versionsLiveOnDay } from '@/utils/checklistVersions';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DollarSign, TrendingUp, TrendingDown, CheckCircle2, Clock, X } from 'lucide-react';
import { DayManagersWorked } from './DayManagersWorked';

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

interface DaySalesLabor {
  netSales: number;
  goal: number | null;
  laborHours: number;
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

  // Cache policy: current period stays fresh-ish, recent history is stable,
  // anything older than 30 days is dropped from cache on navigate-away.
  const cachePolicy = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');
    const thirtyDaysAgo = format(addDays(new Date(), -30), 'yyyy-MM-dd');
    if (endStr >= todayStr) {
      // Current / in-progress period
      return { staleTime: 2 * 60 * 1000, gcTime: 10 * 60 * 1000, refetchOnMount: true as const };
    }
    if (endStr >= thirtyDaysAgo) {
      // Settled recent history — treat as stable, keep cached
      return { staleTime: 60 * 60 * 1000, gcTime: 60 * 60 * 1000, refetchOnMount: false as const };
    }
    // Deep history — do not retain after navigate-away
    return { staleTime: 60 * 60 * 1000, gcTime: 0, refetchOnMount: false as const };
  }, [endDate]);

  const { data: heatmapData, isLoading } = useQuery({
    queryKey: ['checklist-heatmap', currentLocation?.id, rangeKey, closeTime, timezone],
    staleTime: cachePolicy.staleTime,
    gcTime: cachePolicy.gcTime,
    refetchOnMount: cachePolicy.refetchOnMount,
    enabled: !!user && !!currentLocation?.id && !tzLoading,
    queryFn: async (): Promise<Record<string, { completedChecklists: number; totalChecklists: number; pct: number | null }>> => {
      if (!currentLocation?.id) return {};

      // Every version of every list — a version swapped out mid-range still owns the
      // days it was live for. Pending drafts are excluded per day below.
      const { data: checklists } = await supabase
        .from('checklists')
        .select(`
          id,
          template_type,
          frequency,
          visible_days_before_month_end,
          is_active,
          family_id,
          replaces_checklist_id,
          superseded_at,
          checklist_items(id, days_of_week, deleted_at)
        `)
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
          checklist_submissions!inner(checklist_id)
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

        // Score view: an item archived after that period started is still expected
        // for that period; archived before it, it was never expected.
        const expectedItems = (cl: any) => {
          const scoreStart = getScorePeriodStart({
            templateType: cl.template_type,
            frequency: cl.frequency,
            businessDateStr: dateStr,
            dayOfWeekMon0: currentDay,
            timezone,
            closeTime,
          });
          return (cl.checklist_items || []).filter((it: any) => isItemExpectedInPeriod(it, scoreStart));
        };

        // One version per family per day — a mid-week live-now swap must not
        // double-count the list on the days it split.
        const liveThatDay = versionsLiveOnDay(checklists as any[], dayStart);

        // Filter applicable checklists for this day
        const applicable = liveThatDay.filter(cl => {

          const items = expectedItems(cl);
          const isMonthly = cl.frequency === 'monthly';
          if (isMonthly) {
            if (cl.visible_days_before_month_end) {
              const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0);
              const daysUntilEnd = lastDay.getDate() - day.getDate();
              if (daysUntilEnd >= cl.visible_days_before_month_end) return false;
            }
            return items.length > 0;
          }
          if (cl.template_type === 'dynamic') {
            const todayItems = items.filter((it: any) => it.days_of_week?.includes(currentDay));
            return todayItems.length > 0;
          }
          return items.length > 0;
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

          const clExpected = expectedItems(cl);
          const itemIds = cl.template_type === 'dynamic'
            ? new Set(clExpected.filter((it: any) => it.days_of_week?.includes(currentDay)).map((it: any) => it.id))
            : new Set(clExpected.map((it: any) => it.id));
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

  // Fetch per-day sales & labor for the range
  const { data: salesLaborByDate } = useQuery({
    queryKey: ['heatmap-sales-labor', currentLocation?.id, rangeKey],
    staleTime: cachePolicy.staleTime,
    gcTime: cachePolicy.gcTime,
    refetchOnMount: cachePolicy.refetchOnMount,
    enabled: !!currentLocation?.id,
    queryFn: async (): Promise<Record<string, DaySalesLabor>> => {
      const startStr = format(startDate, 'yyyy-MM-dd');
      const endStr = format(endDate, 'yyyy-MM-dd');
      const [salesRes, laborRes] = await Promise.all([
        supabase
          .from('sales_cache')
          .select('sale_date, net_sales, projected_sales, initial_projection, override_projection')
          .eq('location_id', currentLocation!.id)
          .gte('sale_date', startStr)
          .lte('sale_date', endStr),
        supabase
          .from('labor_cache')
          .select('labor_date, labor_hours, source')
          .eq('location_id', currentLocation!.id)
          .gte('labor_date', startStr)
          .lte('labor_date', endStr),
      ]);

      const out: Record<string, DaySalesLabor> = {};
      (salesRes.data || []).forEach((r: any) => {
        out[r.sale_date] = {
          netSales: Number(r.net_sales) || 0,
          goal:
            Number(r.override_projection) ||
            Number(r.initial_projection) ||
            Number(r.projected_sales) ||
            null,
          laborHours: 0,
        };
      });
      // group labor by date, prefer punch_clock over qubeyond
      const laborByDate: Record<string, any[]> = {};
      (laborRes.data || []).forEach((r: any) => {
        (laborByDate[r.labor_date] = laborByDate[r.labor_date] || []).push(r);
      });
      Object.entries(laborByDate).forEach(([d, rows]) => {
        const punch = rows.find(r => r.source === 'punch_clock' && Number(r.labor_hours) > 0);
        const ext = rows.find(r => ['qubeyond', 'aloha', 'clover'].includes(r.source) && Number(r.labor_hours) > 0);
        const preferred = punch || ext;
        const hours = preferred ? Number(preferred.labor_hours) || 0 : 0;
        if (!out[d]) out[d] = { netSales: 0, goal: null, laborHours: hours };
        else out[d].laborHours = hours;
      });
      return out;
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

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
              const isSelected = cell.dateStr === selectedDate;
              const clickable = cell.inRange && !isFuture;
              return (
                <Tooltip key={cell.dateStr}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && setSelectedDate(prev => (prev === cell.dateStr ? null : cell.dateStr))}
                      className={cn(
                        'aspect-square w-full rounded-md flex items-center justify-center text-[11px] font-medium transition-all relative',
                        getColor(cell.completionPct, cell.inRange, isFuture),
                        !cell.inRange && 'opacity-30',
                        isFuture && 'opacity-50',
                        clickable && 'cursor-pointer hover:ring-2 hover:ring-primary/40 active:scale-95',
                        isToday && !isSelected && 'ring-2 ring-primary',
                        isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                        !isFuture && cell.completionPct !== null && cell.completionPct >= 50 ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {format(cell.date, 'd')}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="hidden md:block">
                    <div className="text-xs">
                      <div className="font-semibold">{format(cell.date, 'EEE, MMM d')}</div>
                      {isFuture ? (
                        <div className="text-muted-foreground">Upcoming</div>
                      ) : cell.completionPct === null ? (
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

        {/* Day Details Panel */}
        {selectedDate && (() => {
          const cell = cells.find(c => c.dateStr === selectedDate);
          if (!cell) return null;
          const sl = salesLaborByDate?.[selectedDate];
          const sales = sl?.netSales ?? 0;
          const goal = sl?.goal ?? null;
          const variance = goal !== null ? sales - goal : null;
          const goalPct = goal && goal > 0 ? Math.round((sales / goal) * 100) : null;
          const splh = sl && sl.laborHours > 0 ? sales / sl.laborHours : null;
          const fmt$ = (n: number) =>
            `$${Math.round(n).toLocaleString('en-US')}`;
          return (
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold">{format(cell.date, 'EEEE, MMM d')}</div>
                  {cell.completionPct !== null ? (
                    <div className="text-[11px] text-muted-foreground">
                      {cell.completedChecklists}/{cell.totalChecklists} checklists complete
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">No checklists scheduled</div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="text-muted-foreground hover:text-foreground p-1 -m-1"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {/* Sales vs Goal */}
                <div className="rounded-md bg-background/60 p-2.5">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    <DollarSign className="w-3 h-3" /> Sales
                  </div>
                  <div className="text-sm font-semibold leading-tight">{fmt$(sales)}</div>
                  {goal !== null ? (
                    <>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Goal {fmt$(goal)}</div>
                      {variance !== null && (
                        <div
                          className={cn(
                            'text-[11px] font-medium mt-1 flex items-center gap-0.5 whitespace-nowrap',
                            variance >= 0 ? 'text-emerald-500' : 'text-destructive'
                          )}
                        >
                          {variance >= 0 ? <TrendingUp className="w-3 h-3 shrink-0" /> : <TrendingDown className="w-3 h-3 shrink-0" />}
                          <span>{variance >= 0 ? '+' : '−'}{fmt$(Math.abs(variance))}</span>
                          {goalPct !== null && <span className="text-muted-foreground ml-0.5">({goalPct}%)</span>}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[10px] text-muted-foreground mt-0.5">No goal set</div>
                  )}
                </div>

                {/* Task completion */}
                <div className="rounded-md bg-background/60 p-2.5">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    <CheckCircle2 className="w-3 h-3" /> Tasks
                  </div>
                  <div className="text-sm font-semibold leading-tight">
                    {cell.completionPct !== null ? `${cell.completionPct}%` : '—'}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {cell.completionPct !== null
                      ? `${cell.completedChecklists}/${cell.totalChecklists} done`
                      : 'None scheduled'}
                  </div>
                </div>

                {/* SPLH */}
                <div className="rounded-md bg-background/60 p-2.5">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    <Clock className="w-3 h-3" /> SPLH
                  </div>
                  <div className="text-sm font-semibold leading-tight">
                    {splh !== null ? `$${splh.toFixed(0)}` : '—'}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {sl && sl.laborHours > 0 ? `${sl.laborHours.toFixed(1)} hrs` : 'No labor data'}
                  </div>
              </div>
              {currentLocation?.id && timezone && (
                <div className="col-span-3">
                  <DayManagersWorked
                    dateStr={selectedDate}
                    locationId={currentLocation.id}
                    timezone={timezone}
                    businessDayRange={getBusinessDayRangeInTimezone(selectedDate)}
                  />
                </div>
              )}
            </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

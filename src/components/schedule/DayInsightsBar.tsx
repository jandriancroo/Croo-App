import { useWeekLaborCost } from '@/hooks/useWeekLaborCost';
import { dayPay } from '@/utils/laborCost';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { BarChart3, Radio, Sparkles, CheckCircle2, PencilLine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { canEditDailyGoal } from '@/lib/goalResolver';
import { ProjectionTag } from '@/components/ui/projection-tag';
import { useTeamSalesVisibility } from '@/hooks/useTeamSalesVisibility';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { refreshLiveSalesForToday } from '@/lib/pos/liveSales';
import { fetchStoreLabor } from '@/hooks/useStoreLabor';
import { SalesProjectionDialog } from '@/components/schedule/SalesProjectionDialog';
import { useLaborGoals, laborGoalTone, dowFromDate } from '@/hooks/useLaborGoals';
import { LaborGoalPopover } from '@/components/schedule/LaborGoalPopover';
import { InsightField } from '@/components/schedule/InsightField';
import { ensureFutureWeekLiving } from '@/lib/ensureFutureWeekLiving';

type SalesSource = 'manual' | 'historical' | 'ai' | 'override' | 'living' | 'planning' | 'none';

interface DayShift {
  id: string;
  user_id: string | null;
  start_time: string;
  end_time: string;
  shift_date: string;
  is_time_off?: boolean | null;
  is_phantom?: boolean | null;
}

interface DayProfile {
  id: string;
  hourly_wage?: number;
}

interface DayInsightsBarProps {
  locationId?: string;
  timezone: string;
  /** yyyy-MM-dd business date being viewed */
  dateStr: string;
  /** business "today" in the store timezone */
  todayStr: string;
  /** 0-6 index of this day within the schedule week */
  dayIndex: number;
  scheduleId?: string | null;
  shifts: DayShift[];
  /** The whole week's shifts so weekly OT / 7th day land on the right day */
  weekShifts?: DayShift[];
  profiles: DayProfile[];
  canEdit?: boolean;
  /** Week start (yyyy-MM-dd) used when the shared projection service needs seeding */
  weekStart: string;
}

/**
 * Mobile Day Insights — one column of the desktop Week Insights bar.
 *
 * Uses the exact same resolution the desktop LaborTotals bar uses so the two
 * surfaces can never disagree:
 *   sales  → past: net_sales · today: live POS sales · future: resolved projection
 *   labor  → past: labor_cache (gap-filled from punches) · today: live punch labor
 *            · future: weekLaborCost over the week's scheduled shifts
 */
export function DayInsightsBar({
  locationId,
  timezone,
  dateStr,
  todayStr,
  dayIndex,
  scheduleId,
  shifts,
  weekShifts,
  profiles,
  canEdit = false,
  weekStart,
}: DayInsightsBarProps) {
  const { canSeeSales } = useTeamSalesVisibility();
  const { role } = useUserRole();
  const goalEditable = canEditDailyGoal(role, dateStr, DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd'));
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const laborGoals = useLaborGoals(locationId);
  const [sales, setSales] = useState(0);
  const [todayGoal, setTodayGoal] = useState<number | null>(null);
  const [todayGoalSource, setTodayGoalSource] = useState<SalesSource | undefined>();
  const [salesSource, setSalesSource] = useState<SalesSource | undefined>(undefined);

  const phase: 'completed' | 'today' | 'future' =
    dateStr < todayStr ? 'completed' : dateStr === todayStr ? 'today' : 'future';

  // ---- Scheduled pay: the ONE week calculation over the WEEK's shifts --
  const { pay: weekPay } = useWeekLaborCost(weekShifts ?? shifts, profiles, locationId);

  // ---- Labor for the selected day -----------------------------------------
  const { data: laborData } = useQuery({
    queryKey: ['day-insights-labor', locationId, dateStr],
    queryFn: async () => {
      if (!locationId) return { hours: 0, cost: 0 };

      if (phase === 'today' || phase === 'completed') {
        // One server number (get_store_labor); today is live.
        const { data, error } = await fetchStoreLabor([locationId], dateStr, dateStr);
        if (error) throw error;
        const row = data?.[0];
        return { hours: row?.labor_hours ?? 0, cost: row?.labor_cost ?? 0 };
      }

      return null; // future days computed from schedule below
    },
    enabled: !!locationId && !!dateStr,
    staleTime: phase === 'today' ? 60 * 1000 : 5 * 60 * 1000,
    refetchInterval: phase === 'today' ? 60 * 1000 : false,
  });

  // Scheduled labor (today + future) — same weekLaborCost result as the desktop bar
  const scheduledLabor = useMemo(() => {
    const d = dayPay(weekPay, dateStr);
    return { hours: d.hours, cost: d.cost };
  }, [weekPay, dateStr]);

  const labor = useMemo(() => {
    if (phase === 'future') return scheduledLabor;
    if (laborData && laborData.hours > 0) return laborData;
    if (phase === 'today') return laborData && laborData.hours > 0 ? laborData : scheduledLabor;
    return laborData || { hours: 0, cost: 0 };
  }, [phase, laborData, scheduledLabor]);

  // ---- Sales for the selected day -----------------------------------------
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!locationId || !dateStr) return;
      try {
        const { data: row } = await supabase
          .from('sales_cache')
          .select('net_sales, initial_projection, living_projection, override_projection')
          .eq('location_id', locationId)
          .eq('sale_date', dateStr)
          .maybeSingle();

        const applyProjection = (r: any): boolean => {
          const resolved = resolveProjection({
            initial_projection: r?.initial_projection,
            living_projection: r?.living_projection,
            override_projection: r?.override_projection,
          });
          if (resolved.source !== 'none') {
            if (!cancelled) {
              setSales(Math.round(resolved.value * 100) / 100);
              setSalesSource(resolved.source as SalesSource);
            }
            return true;
          }
          if (!cancelled) { setSales(0); setSalesSource('none'); }
          return false;
        };

        if (phase === 'completed') {
          if (!cancelled) {
            setSales(Math.round((Number(row?.net_sales) || 0) * 100) / 100);
            setSalesSource('historical');
          }
          return;
        }

        if (phase === 'today') {
          const goal = resolveProjection(row);
          if (!cancelled) {
            setTodayGoal(goal.value);
            setTodayGoalSource(goal.source);
          }
          if (Number(row?.net_sales) > 0) {
            if (!cancelled) {
              setSales(Math.round(Number(row?.net_sales) * 100) / 100);
              setSalesSource('living');
            }
          } else {
            applyProjection(row);
          }
          // Refresh through the store's own POS in the background
          refreshLiveSalesForToday(locationId, timezone).then(daily => {
            if (!cancelled && daily && daily > 0) {
              setSales(Math.round(daily * 100) / 100);
              setSalesSource('living');
            }
          }).catch(() => {});
          return;
        }

        // Future day
        if (applyProjection(row)) return;
        // Only a future WEEK may request NULL-only Living from the goal engine.
        await ensureFutureWeekLiving(locationId, weekStart, todayStr, [{ ...row, sale_date: dateStr }]);
        const { data: seeded } = await supabase
          .from('sales_cache')
          .select('initial_projection, living_projection, override_projection')
          .eq('location_id', locationId)
          .eq('sale_date', dateStr)
          .maybeSingle();
        applyProjection(seeded);
      } catch (e) {
        console.error('[DayInsightsBar] sales load failed:', e);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [locationId, dateStr, phase, timezone, weekStart, todayStr]);

  const reloadGoal = async () => {
    const { data, error } = await supabase.from('sales_cache')
      .select('net_sales, initial_projection, living_projection, override_projection')
      .eq('location_id', locationId ?? '').eq('sale_date', dateStr).maybeSingle();
    if (error) throw error;
    const goal = resolveProjection(data);
    if (phase === 'today') { setTodayGoal(goal.value); setTodayGoalSource(goal.source); }
    if (phase === 'future') { setSales(goal.value ?? 0); setSalesSource(goal.source); }
  };
  const saveOverride = async (value: number, excludedDates?: string[]) => {
    if (!locationId || !goalEditable) return;
    const { error } = await supabase.rpc('set_goal_override', {
      _location_id: locationId, _sale_date: dateStr, _value: Math.round(value), _excluded_dates: excludedDates ?? [], _reason: null,
    });
    if (error) {
      toast.error(error.code === '42501' ? 'Only managers and above can change the daily goal.' : 'Failed to save goal');
      throw error;
    }
    await reloadGoal();
    toast.success('Goal saved');
  };
  const resetToProjection = async () => {
    if (!locationId || !goalEditable) return;
    const { error } = await supabase.rpc('clear_goal_override', { _location_id: locationId, _sale_date: dateStr, _reason: null });
    if (error) {
      toast.error(error.code === '42501' ? 'Only managers and above can change the daily goal.' : 'Failed to reset goal');
      throw error;
    }
    await reloadGoal();
    toast.success('Back to the automatic goal');
  };

  if (!canSeeSales) return null;

  const laborPct = sales > 0 ? (labor.cost / sales) * 100 : 0;
  const salesPerLH = labor.hours > 0 ? sales / labor.hours : 0;
  const laborGoal = laborGoals.forDate(dateStr);
  const laborTone = laborGoalTone(laborPct, laborGoal);
  const laborPctColor = laborPct === 0 || laborTone === 'neutral'
    ? 'text-slate-300'
    : laborTone === 'good'
      ? 'text-green-400'
      : laborTone === 'warn'
        ? 'text-yellow-400'
        : 'text-red-400';

  const displaySales = phase === 'today' ? todayGoal : sales;
  const displaySource = phase === 'today' ? todayGoalSource : salesSource;

  const salesButtonClass =
    displaySource === 'override'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
      : displaySource === 'living'
        ? 'border-blue-400/40 bg-blue-500/10 text-blue-200'
        : displaySource === 'planning' || displaySource === 'ai'
          ? 'border-blue-400/20 bg-blue-500/5 text-blue-200'
          : displaySource === 'historical'
            ? 'border-green-500/40 bg-green-500/10 text-green-300'
            : 'border-slate-600/50 text-slate-100';

  const SalesIcon =
    displaySource === 'override' ? PencilLine
      : displaySource === 'living' ? Radio
        : displaySource === 'planning' || displaySource === 'ai' ? Sparkles
          : displaySource === 'historical' ? CheckCircle2
            : null;

  const phaseLabel = phase === 'completed' ? 'Actual' : phase === 'today' ? 'Live' : 'Planned';

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-100 transition-colors ${expanded ? 'bg-slate-900 rounded-b-none' : 'bg-slate-800/90'}`}
      >
        <span className="flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" /> Day Insights
          <span className="text-slate-400 font-normal">· {phaseLabel}</span>
        </span>
        <span className="text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="rounded-b-xl bg-slate-900/95 backdrop-blur-sm border border-t-0 border-slate-700/60 shadow-[0_18px_50px_-12px_rgba(2,6,23,0.7)] px-3 py-3 animate-accordion-down">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">
              {format(new Date(`${dateStr}T12:00:00`), 'EEE, MMM d')}
            </span>
            {phase === 'today' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300">In progress</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white/[0.04] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Hours</p>
              <p className="text-lg font-bold text-slate-100">{labor.hours.toFixed(1)}h</p>
              {phase !== 'future' && (
                <p className="text-[10px] text-slate-400">Sched {scheduledLabor.hours.toFixed(1)}h</p>
              )}
            </div>
            <div className="rounded-lg bg-white/[0.04] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Labor</p>
              <p className="text-lg font-bold text-slate-100">
                ${labor.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              {phase !== 'future' && (
                <p className="text-[10px] text-slate-400">Sched ${scheduledLabor.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              )}
            </div>
            <div className="rounded-lg bg-white/[0.04] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Labor %</p>
              <p className={`text-lg font-bold ${laborPctColor}`}>{laborPct.toFixed(1)}%</p>
              {laborGoals.available && laborGoal != null && (
                <div className="mt-1">
                  <LaborGoalPopover dow={dowFromDate(dateStr)} projectedSales={sales} canEdit={canEdit}>
                    <InsightField
                      showPencil={canEdit}
                      className="h-7"
                      aria-label="Edit labor goal"
                      value={<span className="text-[11px] text-slate-300">goal <span className="font-semibold text-slate-100">{laborGoal}%</span></span>}
                    />
                  </LaborGoalPopover>
                </div>
              )}
            </div>
            <div className="rounded-lg bg-white/[0.04] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">$/LH</p>
              <p className="text-lg font-bold text-slate-100">${salesPerLH.toFixed(2)}</p>
            </div>
          </div>

          <button
            data-sales-cell={dateStr}
            onClick={() => setDialogOpen(true)}
            className={`mt-2 w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${salesButtonClass}`}
          >
            <span className="text-[10px] uppercase tracking-wide opacity-80">
              {phase === 'completed' ? 'Sales' : 'Sales goal'}
            </span>
            <span className="flex items-center gap-1.5 text-lg font-bold">
              {SalesIcon && <SalesIcon className="h-3.5 w-3.5" />}
              {displaySales != null ? `$${displaySales.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            </span>
          </button>
          {phase !== 'completed' && <ProjectionTag source={displaySource === 'override' || displaySource === 'living' || displaySource === 'planning' ? displaySource : 'none'} locationId={locationId} dateStr={dateStr} timezone={timezone} className="mt-1" />}
        </div>
      )}

      <SalesProjectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        locationId={locationId}
        dateStr={dateStr}
        todayStr={todayStr}
        currentValue={displaySales ?? 0}
        currentSource={displaySource}
        canEdit={goalEditable}
        onSaveOverride={saveOverride}
        onResetToProjection={resetToProjection}
      />
    </div>
  );
}

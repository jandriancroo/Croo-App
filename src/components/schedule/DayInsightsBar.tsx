import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { BarChart3, Radio, Sparkles, CheckCircle2, PencilLine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useTeamSalesVisibility } from '@/hooks/useTeamSalesVisibility';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { refreshLiveSalesForToday } from '@/lib/pos/liveSales';
import { fetchActualLaborForDates, fetchLiveLaborForToday } from '@/utils/liveLabor';
import { SalesProjectionDialog } from '@/components/schedule/SalesProjectionDialog';

type SalesSource = 'manual' | 'historical' | 'ai' | 'override' | 'living' | 'initial';

interface DayShift {
  id: string;
  user_id: string | null;
  start_time: string;
  end_time: string;
  shift_date: string;
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
 *            · future: scheduled shifts with the location's OT/DT rules
 */
export function DayInsightsBar({
  locationId,
  timezone,
  dateStr,
  todayStr,
  dayIndex,
  scheduleId,
  shifts,
  profiles,
  canEdit = false,
  weekStart,
}: DayInsightsBarProps) {
  const { canSeeSales } = useTeamSalesVisibility();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sales, setSales] = useState(0);
  const [salesSource, setSalesSource] = useState<SalesSource | undefined>(undefined);

  const phase: 'completed' | 'today' | 'future' =
    dateStr < todayStr ? 'completed' : dateStr === todayStr ? 'today' : 'future';

  // ---- Labor rules (OT/DT) -------------------------------------------------
  const { data: laborRules } = useQuery({
    queryKey: ['labor-rules-schedule', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data } = await supabase
        .from('labor_rules')
        .select('daily_overtime_threshold, daily_double_time_threshold, overtime_multiplier, double_time_multiplier')
        .eq('location_id', locationId)
        .maybeSingle();
      return data;
    },
    enabled: !!locationId,
    staleTime: 30 * 60 * 1000,
  });

  // ---- Wages for this day's scheduled shifts ------------------------------
  const shiftsKey = shifts.map(s => `${s.id}-${s.user_id}`).join('|');
  const { data: shiftWages = {} } = useQuery({
    queryKey: ['day-insights-wages', dateStr, shiftsKey],
    queryFn: async () => {
      const wages: Record<string, number> = {};
      await Promise.all(shifts.map(async shift => {
        if (!shift.user_id) return;
        const { data } = await supabase.rpc('get_current_wage', {
          p_user_id: shift.user_id,
          p_date: shift.shift_date,
        });
        if (data !== null && data !== undefined) wages[shift.id] = Number(data);
      }));
      return wages;
    },
    enabled: shifts.length > 0 && phase !== 'completed',
    staleTime: 5 * 60 * 1000,
  });

  // ---- Labor for the selected day -----------------------------------------
  const { data: laborData } = useQuery({
    queryKey: ['day-insights-labor', locationId, dateStr],
    queryFn: async () => {
      if (!locationId) return { hours: 0, cost: 0 };

      if (phase === 'today') {
        const live = await fetchLiveLaborForToday(locationId, timezone);
        return { hours: live.hours, cost: live.cost };
      }

      if (phase === 'completed') {
        const { data } = await supabase
          .from('labor_cache')
          .select('labor_hours, labor_cost, source')
          .eq('location_id', locationId)
          .eq('labor_date', dateStr);
        const rows = data || [];
        const punchRow = rows.find((r: any) => r.source === 'punch_clock' && (Number(r.labor_hours) > 0 || Number(r.labor_cost) > 0));
        const externalRow = rows.find((r: any) => ['qubeyond', 'aloha', 'clover'].includes(r.source) && (Number(r.labor_hours) > 0 || Number(r.labor_cost) > 0));
        const preferred = punchRow || externalRow;
        if (Number(preferred?.labor_hours) > 0) {
          return { hours: Number(preferred?.labor_hours) || 0, cost: Number(preferred?.labor_cost) || 0 };
        }
        // Gap-fill straight from punches (read-only, no cache writes)
        try {
          const fromPunches = await fetchActualLaborForDates(locationId, timezone || 'America/Los_Angeles', [dateStr]);
          const value = fromPunches[dateStr];
          if (value?.hours > 0) return value;
        } catch (e) {
          console.error('[DayInsightsBar] punch labor fallback failed:', e);
        }
        return { hours: 0, cost: 0 };
      }

      return null; // future days computed from schedule below
    },
    enabled: !!locationId && !!dateStr,
    staleTime: phase === 'today' ? 60 * 1000 : 5 * 60 * 1000,
    refetchInterval: phase === 'today' ? 60 * 1000 : false,
  });

  // Scheduled labor (today + future) — identical math to the desktop bar
  const scheduledLabor = useMemo(() => {
    const rawDailyOT = laborRules?.daily_overtime_threshold;
    const rawDailyDT = laborRules?.daily_double_time_threshold;
    const dailyOT = rawDailyOT && rawDailyOT > 0 ? rawDailyOT : Infinity;
    const dailyDT = rawDailyDT && rawDailyDT > 0 ? rawDailyDT : Infinity;
    const otMult = laborRules?.overtime_multiplier ?? 1.5;
    const dtMult = laborRules?.double_time_multiplier ?? 2.0;

    let totalHours = 0;
    let totalWages = 0;
    const byEmployee: Record<string, { hours: number; wage: number }> = {};

    shifts.forEach(shift => {
      if (!shift.user_id) return;
      const [sh, sm] = shift.start_time.split(':').map(Number);
      const [eh, em] = shift.end_time.split(':').map(Number);
      let hours = eh - sh;
      let minutes = em - sm;
      if (minutes < 0) { hours -= 1; minutes += 60; }
      if (hours < 0) hours += 24;
      let shiftHours = hours + minutes / 60;
      if (shiftHours > 5) shiftHours -= 0.5;
      totalHours += shiftHours;

      const wage = (shiftWages as Record<string, number>)[shift.id]
        ?? profiles.find(p => p.id === shift.user_id)?.hourly_wage
        ?? 15;
      if (!byEmployee[shift.user_id]) byEmployee[shift.user_id] = { hours: 0, wage };
      byEmployee[shift.user_id].hours += shiftHours;
      byEmployee[shift.user_id].wage = wage;
    });

    Object.values(byEmployee).forEach(({ hours: empHours, wage }) => {
      if (empHours <= dailyOT) {
        totalWages += empHours * wage;
      } else if (empHours <= dailyDT) {
        totalWages += dailyOT * wage + (empHours - dailyOT) * wage * otMult;
      } else {
        totalWages += dailyOT * wage
          + (dailyDT - dailyOT) * wage * otMult
          + (empHours - dailyDT) * wage * dtMult;
      }
    });

    return { hours: totalHours, cost: totalWages };
  }, [shifts, profiles, shiftWages, laborRules]);

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
          .select('net_sales, initial_projection, living_projection, override_projection, projected_sales')
          .eq('location_id', locationId)
          .eq('sale_date', dateStr)
          .maybeSingle();

        const applyProjection = (r: any): boolean => {
          const resolved = resolveProjection({
            initial_projection: r?.initial_projection,
            living_projection: r?.living_projection,
            override_projection: r?.override_projection,
            projected_sales: r?.projected_sales,
          });
          if (resolved.value && resolved.value > 0) {
            if (!cancelled) {
              setSales(Math.round(resolved.value * 100) / 100);
              setSalesSource(resolved.source === 'legacy' ? 'ai' : (resolved.source as SalesSource));
            }
            return true;
          }
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
          if (Number(row?.net_sales) > 0) {
            if (!cancelled) {
              setSales(Math.round(Number(row?.net_sales) * 100) / 100);
              setSalesSource('living');
            }
          } else {
            applyProjection({ ...row, projected_sales: null });
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
        // Missing projection → shared POS-neutral projection service
        const { error: seedError } = await supabase.functions.invoke('sales-week-projections', {
          body: { action: 'seed_week', locationId, weekStart },
        });
        if (seedError) return;
        const { data: seeded } = await supabase
          .from('sales_cache')
          .select('initial_projection, living_projection, override_projection, projected_sales')
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
  }, [locationId, dateStr, phase, timezone, weekStart]);

  const saveOverride = async (value: number, excludedDates?: string[]) => {
    if (!locationId) return;
    setSales(value);
    setSalesSource('override');
    try {
      const { error } = await (supabase.from('sales_cache') as any).upsert({
        location_id: locationId,
        sale_date: dateStr,
        override_projection: value,
        override_at: new Date().toISOString(),
        override_by: user?.id || null,
        override_excluded_dates: excludedDates ?? [],
      }, { onConflict: 'location_id,sale_date' });
      if (error) throw error;

      if (scheduleId) {
        await supabase.from('schedule_projected_sales').upsert({
          schedule_id: scheduleId,
          day_of_week: dayIndex,
          projected_sales: value,
        }, { onConflict: 'schedule_id,day_of_week' });
      }
      toast.success('Goal saved');
    } catch (e) {
      console.error('[DayInsightsBar] override save failed:', e);
      toast.error('Failed to save goal');
    }
  };

  const resetToProjection = async () => {
    if (!locationId) return;
    try {
      await (supabase.from('sales_cache') as any)
        .update({ override_projection: null, override_at: null, override_by: null, override_excluded_dates: null })
        .eq('location_id', locationId)
        .eq('sale_date', dateStr);

      if (scheduleId) {
        await supabase
          .from('schedule_projected_sales')
          .delete()
          .eq('schedule_id', scheduleId)
          .eq('day_of_week', dayIndex);
      }

      const { data: row } = await supabase
        .from('sales_cache')
        .select('net_sales, initial_projection, living_projection, projected_sales')
        .eq('location_id', locationId)
        .eq('sale_date', dateStr)
        .maybeSingle();

      if (phase === 'future') {
        const resolved = resolveProjection({
          initial_projection: row?.initial_projection,
          living_projection: row?.living_projection,
          override_projection: null,
          projected_sales: row?.projected_sales,
        });
        setSales(Math.round((resolved.value || 0) * 100) / 100);
        setSalesSource(resolved.source === 'legacy' ? 'ai' : (resolved.source as SalesSource));
      } else {
        setSales(Math.round((Number(row?.net_sales) || 0) * 100) / 100);
        setSalesSource(phase === 'today' ? 'living' : 'historical');
      }
      toast.success('Back to the automatic goal');
    } catch (e) {
      console.error('[DayInsightsBar] reset failed:', e);
      toast.error('Failed to reset goal');
    }
  };

  if (!canSeeSales) return null;

  const laborPct = sales > 0 ? (labor.cost / sales) * 100 : 0;
  const salesPerLH = labor.hours > 0 ? sales / labor.hours : 0;
  const laborPctColor = laborPct === 0
    ? 'text-slate-300'
    : laborPct <= 30
      ? 'text-green-400'
      : laborPct <= 35
        ? 'text-yellow-400'
        : 'text-red-400';

  const salesButtonClass =
    salesSource === 'override'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
      : salesSource === 'living'
        ? 'border-blue-400/40 bg-blue-500/10 text-blue-200'
        : salesSource === 'initial' || salesSource === 'ai'
          ? 'border-blue-400/20 bg-blue-500/5 text-blue-200'
          : salesSource === 'historical'
            ? 'border-green-500/40 bg-green-500/10 text-green-300'
            : 'border-slate-600/50 text-slate-100';

  const SalesIcon =
    salesSource === 'override' ? PencilLine
      : salesSource === 'living' ? Radio
        : salesSource === 'initial' || salesSource === 'ai' ? Sparkles
          : salesSource === 'historical' ? CheckCircle2
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
            </div>
            <div className="rounded-lg bg-white/[0.04] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Labor</p>
              <p className="text-lg font-bold text-slate-100">
                ${labor.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Labor %</p>
              <p className={`text-lg font-bold ${laborPctColor}`}>{laborPct.toFixed(1)}%</p>
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
              ${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </button>
        </div>
      )}

      <SalesProjectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        locationId={locationId}
        dateStr={dateStr}
        todayStr={todayStr}
        currentValue={sales}
        currentSource={salesSource}
        canEdit={canEdit && phase !== 'completed'}
        onSaveOverride={saveOverride}
        onResetToProjection={resetToProjection}
      />
    </div>
  );
}

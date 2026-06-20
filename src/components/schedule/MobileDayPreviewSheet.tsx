import { useEffect, useState } from "react";
import { format, subWeeks } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sparkles, Loader2, Clock, Users, DollarSign, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { formatTime12Hour, cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { getCachedSalesData, setCachedSalesData } from "@/utils/salesCache";
import { getTodayInTimezone } from "@/utils/timezoneUtils";
import { Button } from "@/components/ui/button";

interface PendingDraft {
  employeeId: string;
  employeeName: string;
  employeePhoto?: string | null;
  start: string;
  end: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  scheduleId: string;
  shifts: any[];
  profiles: { id: string; full_name?: string | null; nickname?: string | null; hourly_wage?: number | null; profile_photo_url?: string | null }[];
  locationSettings?: { hours_open?: string; hours_close?: string } | null;
  pendingDraft?: PendingDraft | null;
}

function calcWorkedHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let h = (eh + em / 60) - (sh + sm / 60);
  if (h < 0) h += 24;
  return h > 5 ? h - 0.5 : h;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function laborPctClass(pct: number) {
  if (pct <= 0) return "text-muted-foreground";
  if (pct <= 30) return "text-emerald-600 dark:text-emerald-400";
  if (pct <= 35) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function MobileDayPreviewSheet({
  open,
  onOpenChange,
  date,
  scheduleId,
  shifts,
  profiles,
  locationSettings,
  pendingDraft,
}: Props) {
  const dateStr = format(date, "yyyy-MM-dd");
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const [showHourly, setShowHourly] = useState(false);

  const [salesData, setSalesData] = useState<{
    daily: number;
    hourly: Record<number, number>;
    isProjection: boolean;
  } | null>(null);
  const [isLoadingSales, setIsLoadingSales] = useState(false);

  useEffect(() => {
    if (!open) {
      setSalesData(null);
      setShowHourly(false);
      return;
    }
    if (!currentLocation?.id) return;
    let cancelled = false;

    const run = async () => {
      const todayStr = getTodayInTimezone(timezone);
      const isPast = dateStr < todayStr;
      const isFuture = dateStr > todayStr;

      if (isPast) {
        const cached = getCachedSalesData(currentLocation.id, dateStr, timezone);
        if (cached) {
          const hourlyMap: Record<number, number> = {};
          cached.hourly.forEach((item) => {
            const hourNum = parseInt(item.hour.split(":")[0]);
            hourlyMap[hourNum] = item.sales || 0;
          });
          if (!cancelled) setSalesData({ daily: cached.daily, hourly: hourlyMap, isProjection: false });
          return;
        }
      }

      setIsLoadingSales(true);
      try {
        const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
          body: { locationId: currentLocation.id, targetDate: dateStr },
        });
        if (error || !data || cancelled) return;
        const hourlyMap: Record<number, number> = {};
        if (Array.isArray(data.hourly)) {
          data.hourly.forEach((item: any) => {
            const hourNum = parseInt(item.hour.split(":")[0]);
            hourlyMap[hourNum] = isFuture ? (item.projected || 0) : (item.sales || 0);
          });
        }
        const daily = isFuture ? (data.projections?.todayProjected || 0) : (data.daily || 0);
        if (isPast && data.daily > 0) {
          setCachedSalesData(currentLocation.id, dateStr, {
            daily: data.daily,
            hourly: data.hourly || [],
            guestCount: data.guestCount || { daily: 0 },
          }, timezone);
        }
        if (!cancelled) setSalesData({ daily, hourly: hourlyMap, isProjection: isFuture });
      } catch (e) {
        console.error("MobileDayPreview sales fetch failed", e);
      } finally {
        if (!cancelled) setIsLoadingSales(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [open, currentLocation?.id, dateStr, timezone]);

  const dayShifts = (shifts || []).filter(
    (s) => s.shift_date === dateStr && s.schedule_id === scheduleId && !s.is_time_off
  );
  const sorted = [...dayShifts].sort((a, b) => {
    const [ah, am] = a.start_time.split(":").map(Number);
    const [bh, bm] = b.start_time.split(":").map(Number);
    return (ah * 60 + am) - (bh * 60 + bm);
  });

  const profileFor = (id: string | null) => profiles.find((p) => p.id === id) || null;

  const totalHours = dayShifts.reduce((s, sh) => s + calcWorkedHours(sh.start_time, sh.end_time), 0);
  const totalCost = dayShifts.reduce((s, sh) => {
    const p = profileFor(sh.user_id);
    return s + calcWorkedHours(sh.start_time, sh.end_time) * (p?.hourly_wage ?? 15);
  }, 0);
  const laborPct = salesData?.daily ? (totalCost / salesData.daily) * 100 : 0;

  // hourly breakdown
  const earliest = locationSettings?.hours_open ? parseInt(locationSettings.hours_open.split(":")[0]) : 8;
  const latest = locationSettings?.hours_close ? parseInt(locationSettings.hours_close.split(":")[0]) : 22;
  let lo = earliest, hi = latest;
  dayShifts.forEach((s) => {
    const [sh] = s.start_time.split(":").map(Number);
    const [eh] = s.end_time.split(":").map(Number);
    const effEnd = eh < sh ? 24 : eh;
    lo = Math.min(lo, sh);
    hi = Math.max(hi, effEnd);
  });
  const hours = Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i);

  const hourly: Record<number, { hours: number; cost: number; count: number }> = {};
  dayShifts.forEach((shift) => {
    const [sh, sm] = shift.start_time.split(":").map(Number);
    const [eh, em] = shift.end_time.split(":").map(Number);
    let st = sh + sm / 60;
    let et = eh + em / 60;
    if (et < st) et += 24;
    const wage = profileFor(shift.user_id)?.hourly_wage ?? 15;
    for (let h = Math.floor(st); h < Math.ceil(et); h++) {
      const slot = Math.min(h + 1, et) - Math.max(h, st);
      if (!hourly[h]) hourly[h] = { hours: 0, cost: 0, count: 0 };
      hourly[h].hours += slot;
      hourly[h].cost += slot * wage;
      hourly[h].count += 1;
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[92vh] p-0 flex flex-col gap-0 rounded-t-2xl"
      >
        {/* Header */}
        <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <div className="mx-auto w-10 h-1 rounded-full bg-muted mb-2" />
          <SheetTitle className="text-left">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              {format(date, "EEEE")}
            </div>
            <div className="text-xl font-bold">{format(date, "MMMM d, yyyy")}</div>
          </SheetTitle>
        </SheetHeader>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
          {/* Sales + Labor % hero */}
          <div className="rounded-2xl border bg-gradient-to-br from-primary/5 to-primary/10 p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {salesData?.isProjection ? "Projected Sales" : "Daily Sales"}
              </span>
              <div className="flex items-center gap-1">
                {salesData?.isProjection && (
                  <Badge variant="secondary" className="text-[10px] gap-1 h-5">
                    <Sparkles className="h-3 w-3" /> Croo AI
                  </Badge>
                )}
                {isLoadingSales && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
            </div>
            <div className="text-3xl font-bold text-foreground">
              {salesData ? formatCurrency(salesData.daily) : isLoadingSales ? "—" : "$0"}
            </div>
            {salesData?.daily ? (
              <div className="mt-2 flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">Labor:</span>
                <span className={cn("font-bold", laborPctClass(laborPct))}>{laborPct.toFixed(1)}%</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{formatCurrency(totalCost)}</span>
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                Labor: <span className="font-semibold text-foreground">{formatCurrency(totalCost)}</span>
              </div>
            )}
          </div>

          {/* 3 stat tiles */}
          <div className="grid grid-cols-3 gap-2">
            <StatTile icon={<Users className="h-4 w-4" />} label="Shifts" value={dayShifts.length.toString()} />
            <StatTile icon={<Clock className="h-4 w-4" />} label="Hours" value={totalHours.toFixed(1)} />
            <StatTile icon={<DollarSign className="h-4 w-4" />} label="Labor" value={formatCurrency(totalCost)} />
          </div>

          {/* Shifts list */}
          <div className="rounded-2xl border overflow-hidden">
            <div className="px-3 py-2 bg-muted/40 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide">Scheduled Shifts</span>
              <span className="text-xs text-muted-foreground">{dayShifts.length}</span>
            </div>
            {sorted.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No shifts scheduled
              </div>
            ) : (
              <div className="divide-y">
                {sorted.map((shift) => {
                  const p = profileFor(shift.user_id);
                  const name = p ? (p.nickname || p.full_name || "Hidden") : (shift.user_id ? "Hidden" : "Unassigned");
                  const wh = calcWorkedHours(shift.start_time, shift.end_time);
                  const wage = p?.hourly_wage ?? 15;
                  const cost = wh * wage;
                  const color = shift.template?.color || shift.color || "hsl(var(--primary))";
                  return (
                    <div key={shift.id} className="flex items-center gap-3 px-3 py-2.5">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarImage src={p?.profile_photo_url || undefined} />
                        <AvatarFallback className="text-xs">{name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <p className="text-sm font-semibold truncate">{name}</p>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {formatTime12Hour(shift.start_time)} – {formatTime12Hour(shift.end_time)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums">{wh.toFixed(1)}h</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">{formatCurrency(cost)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hourly breakdown (collapsible) */}
          {hours.length > 0 && (
            <div className="rounded-2xl border overflow-hidden">
              <button
                type="button"
                onClick={() => setShowHourly((v) => !v)}
                className="w-full px-3 py-2.5 bg-muted/40 flex items-center justify-between active:bg-muted"
              >
                <span className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Hourly Breakdown
                  {salesData?.isProjection && <Sparkles className="h-3 w-3 text-primary" />}
                </span>
                {showHourly ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showHourly && (
                <div className="divide-y">
                  {hours.map((h) => {
                    const d = hourly[h] || { hours: 0, cost: 0, count: 0 };
                    const sales = salesData?.hourly[h] || 0;
                    const pct = sales > 0 ? (d.cost / sales) * 100 : 0;
                    const hour12 = h % 12 === 0 ? 12 : h % 12;
                    const period = h < 12 || h === 24 ? "AM" : "PM";
                    const isEmpty = d.count === 0 && sales === 0;
                    if (isEmpty) return null;
                    return (
                      <div key={h} className="flex items-center px-3 py-2 text-xs">
                        <span className="w-12 font-semibold tabular-nums">{hour12} {period}</span>
                        <div className="flex-1 flex items-center gap-1.5 text-muted-foreground">
                          <Users className="h-3 w-3" />
                          <span className="tabular-nums">{d.count}</span>
                          <span className="mx-1">·</span>
                          <span className="tabular-nums">{d.hours.toFixed(1)}h</span>
                        </div>
                        <div className="text-right">
                          <div className="tabular-nums font-medium">{sales > 0 ? formatCurrency(sales) : "—"}</div>
                          <div className={cn("tabular-nums text-[11px] font-semibold", laborPctClass(pct))}>
                            {sales > 0 ? `${pct.toFixed(0)}%` : `${formatCurrency(d.cost)}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-3 shrink-0 bg-background">
          <Button className="w-full" variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wide font-medium">{label}</span>
      </div>
      <div className="text-base font-bold tabular-nums truncate">{value}</div>
    </div>
  );
}

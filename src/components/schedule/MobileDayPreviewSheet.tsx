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
import { useLocationStations } from "@/hooks/useLocationStations";
import { useUserStationAssignments } from "@/hooks/useUserStationAssignments";
import { useQuery } from "@tanstack/react-query";

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

  // Stations support
  const { stations } = useLocationStations(currentLocation?.id);
  const { assignments: stationAssignments } = useUserStationAssignments(currentLocation?.id);
  const { data: stationsEnabledRow } = useQuery({
    queryKey: ['location_stations_enabled', currentLocation?.id],
    enabled: !!currentLocation?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('location_settings')
        .select('stations_enabled')
        .eq('location_id', currentLocation!.id)
        .maybeSingle();
      return data;
    },
  });
  const stationsEnabled = !!(stationsEnabledRow as any)?.stations_enabled && (stations ?? []).length > 0;

  // Pending draft hours/cost
  const pendingHours = pendingDraft ? calcWorkedHours(pendingDraft.start, pendingDraft.end) : 0;
  const pendingWage = pendingDraft ? (profileFor(pendingDraft.employeeId)?.hourly_wage ?? 15) : 15;
  const pendingCost = pendingHours * pendingWage;

  const totalHours = dayShifts.reduce((s, sh) => s + calcWorkedHours(sh.start_time, sh.end_time), 0) + pendingHours;
  const totalCost = dayShifts.reduce((s, sh) => {
    const p = profileFor(sh.user_id);
    return s + calcWorkedHours(sh.start_time, sh.end_time) * (p?.hourly_wage ?? 15);
  }, 0) + pendingCost;
  const laborPct = salesData?.daily ? (totalCost / salesData.daily) * 100 : 0;

  // hourly breakdown
  const earliest = locationSettings?.hours_open ? parseInt(locationSettings.hours_open.split(":")[0]) : 8;
  const latest = locationSettings?.hours_close ? parseInt(locationSettings.hours_close.split(":")[0]) : 22;
  let lo = earliest, hi = latest;
  const extendBounds = (start: string, end: string) => {
    const [sh] = start.split(":").map(Number);
    const [eh] = end.split(":").map(Number);
    const effEnd = eh < sh ? 24 : eh;
    lo = Math.min(lo, sh);
    hi = Math.max(hi, effEnd);
  };
  dayShifts.forEach((s) => extendBounds(s.start_time, s.end_time));
  if (pendingDraft) extendBounds(pendingDraft.start, pendingDraft.end);
  const hours = Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i);

  const hourly: Record<number, { hours: number; cost: number; count: number }> = {};
  const accumulateHourly = (start: string, end: string, wage: number) => {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let st = sh + sm / 60;
    let et = eh + em / 60;
    if (et < st) et += 24;
    for (let h = Math.floor(st); h < Math.ceil(et); h++) {
      const slot = Math.min(h + 1, et) - Math.max(h, st);
      if (!hourly[h]) hourly[h] = { hours: 0, cost: 0, count: 0 };
      hourly[h].hours += slot;
      hourly[h].cost += slot * wage;
      hourly[h].count += 1;
    }
  };
  dayShifts.forEach((shift) => {
    accumulateHourly(shift.start_time, shift.end_time, profileFor(shift.user_id)?.hourly_wage ?? 15);
  });
  if (pendingDraft) accumulateHourly(pendingDraft.start, pendingDraft.end, pendingWage);

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
            <StatTile icon={<Users className="h-4 w-4" />} label="Shifts" value={(dayShifts.length + (pendingDraft ? 1 : 0)).toString()} />
            <StatTile icon={<Clock className="h-4 w-4" />} label="Hours" value={totalHours.toFixed(1)} />
            <StatTile icon={<DollarSign className="h-4 w-4" />} label="Labor" value={formatCurrency(totalCost)} />
          </div>

          {/* Shifts list */}
          <div className="rounded-2xl border overflow-hidden">
            <div className="px-3 py-2 bg-muted/40 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide">Scheduled Shifts</span>
              <span className="text-xs text-muted-foreground">{dayShifts.length + (pendingDraft ? 1 : 0)}</span>
            </div>
            {sorted.length === 0 && !pendingDraft ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No shifts scheduled
              </div>
            ) : (
              <div className="divide-y">
                {/* Pending draft row (highlighted) */}
                {pendingDraft && (
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-primary/5 border-l-2 border-primary">
                    <Avatar className="h-9 w-9 shrink-0 ring-2 ring-primary/40">
                      <AvatarImage src={pendingDraft.employeePhoto || undefined} />
                      <AvatarFallback className="text-xs">{pendingDraft.employeeName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-semibold truncate">{pendingDraft.employeeName}</p>
                        <Badge className="h-4 px-1.5 text-[9px] font-bold uppercase tracking-wide shrink-0">
                          Pending
                        </Badge>
                      </div>
                      <p className="text-xs text-primary font-medium truncate">
                        {formatTime12Hour(pendingDraft.start)} – {formatTime12Hour(pendingDraft.end)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums text-primary">{pendingHours.toFixed(1)}h</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">{formatCurrency(pendingCost)}</p>
                    </div>
                  </div>
                )}
                {(() => {
                  const renderRow = (shift: any) => {
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
                  };

                  if (!stationsEnabled) {
                    return sorted.map(renderRow);
                  }

                  const groups: { id: string; name: string; color: string; items: any[] }[] = [
                    ...(stations ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color, items: [] as any[] })),
                    { id: "__unassigned__", name: "Unassigned", color: "hsl(var(--muted-foreground))", items: [] as any[] },
                  ];
                  for (const shift of sorted) {
                    const sid = shift.user_id ? (stationAssignments[shift.user_id] ?? null) : null;
                    const bucket = groups.find((g) => g.id === sid) ?? groups[groups.length - 1];
                    bucket.items.push(shift);
                  }
                  return groups
                    .filter((g) => g.items.length > 0)
                    .map((g) => (
                      <div key={g.id}>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: g.color }} />
                          <span className="text-[11px] font-semibold uppercase tracking-wide">{g.name}</span>
                          <span className="text-[11px] text-muted-foreground ml-auto">{g.items.length}</span>
                        </div>
                        <div className="divide-y">
                          {g.items.map(renderRow)}
                        </div>
                      </div>
                    ));
                })()}
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

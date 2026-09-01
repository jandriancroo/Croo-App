import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, Check, ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { getEffectivePeriodEndDate } from "@/utils/periodLabelUtils";
import { motion, AnimatePresence } from "framer-motion";

import PeriodDetailPanel from "@/components/inventory/PeriodDetailPanel";
import PendingTransfersSection from "@/components/inventory/PendingTransfersSection";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useInventoryPeriodSettings, computePeriodEndDate } from "@/hooks/useInventoryPeriodSettings";

interface InventoryCountTabProps {
  locationId: string;
  inProgressCount: any | null;
  recentCounts: any[] | undefined;
  onStartCount: () => void;
  onDeleteCount: (count: any) => void;
  onCreateCountForPeriod?: (periodType: string, periodEndDate: string) => void;
  onStartDailyCount?: () => void;
}

export default function InventoryCountTab({
  locationId,
  inProgressCount,
  recentCounts,
  onStartCount,
  onDeleteCount,
  onCreateCountForPeriod,
  onStartDailyCount,
}: InventoryCountTabProps) {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<"all" | "weekly" | "monthly">("all");
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [pageIndex, setPageIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(6);
  // tabsRef removed — old horizontal tab strip replaced by Design D divider list.

  // Merge in-progress into recentCounts stats if available
  const inProgressWithStats = useMemo(() => {
    if (!inProgressCount) return null;
    const match = recentCounts?.find((c) => c.id === inProgressCount.id);
    return match || { ...inProgressCount, _stats: { totalItems: 0, countedItems: 0, totalCost: 0 } };
  }, [inProgressCount, recentCounts]);

  // Completed + in-progress counts
  const completedCounts = useMemo(
    () => (recentCounts || []).filter((c) => c.status === "completed" || c.status === "in_progress"),
    [recentCounts]
  );

  const { getTodayInTimezone } = useLocationTimezone();
  const { config: periodConfig } = useInventoryPeriodSettings(locationId);

  // Only the nearest upcoming weekly + nearest upcoming monthly are surfaced.
  // Past periods with no real count row are hidden (rule: hide past empty only).
  const upcomingEntries = useMemo(() => {
    if (recentCounts === undefined) return [];
    const todayStr = getTodayInTimezone();
    const allCounts = recentCounts || [];
    const out: any[] = [];

    const mkUpcoming = (period_type: "weekly" | "monthly", end: string) => ({
      id: `_upcoming_${period_type}_${end}`,
      status: "upcoming",
      period_type,
      period_end_date: end,
      count_date: end,
      _isUpcoming: true,
      _stats: { totalItems: 0, countedItems: 0, totalCost: 0 },
    });

    // Nearest upcoming weekly: current configured period end (≥ today by definition).
    const weekEnd = computePeriodEndDate(todayStr, periodConfig.periodEndDay);
    if (weekEnd >= todayStr && !allCounts.some(c => c.period_type === "weekly" && c.period_end_date === weekEnd)) {
      out.push(mkUpcoming("weekly", weekEnd));
    }

    // Monthly: if last month was never counted, that's still the period that
    // needs doing — surface it instead of jumping ahead to the current month.
    const [yStr, mStr] = todayStr.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10); // 1-12
    const lastOfMonth = (yy: number, mm: number) => {
      const d = new Date(yy, mm, 0); // day 0 of next month = last of this month
      const yyyy = d.getFullYear();
      const mmStr = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mmStr}-${dd}`;
    };
    const hasMonthly = (end: string) =>
      allCounts.some(c => c.period_type === "monthly" && c.period_end_date === end);

    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const prevMonthEnd = lastOfMonth(prevY, prevM);

    let monthEnd = lastOfMonth(y, m);
    if (monthEnd < todayStr) {
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      monthEnd = lastOfMonth(ny, nm);
    }
    // Outstanding prior month wins the slot.
    if (!hasMonthly(prevMonthEnd)) {
      out.push(mkUpcoming("monthly", prevMonthEnd));
    } else if (!hasMonthly(monthEnd)) {
      out.push(mkUpcoming("monthly", monthEnd));
    }


    return out;
  }, [recentCounts, getTodayInTimezone, periodConfig.periodEndDay]);

  const { filteredCounts, hasMoreHistory } = useMemo(() => {
    const base = typeFilter === "all"
      ? completedCounts
      : completedCounts.filter((c) => c.period_type === typeFilter);

    const upcoming = upcomingEntries.filter(u => typeFilter === "all" || u.period_type === typeFilter);
    const combined = [...upcoming, ...base];

    // Dedupe by effective end date. When a monthly and weekly share the same
    // end date, monthly wins (one count satisfies both). Within the same
    // period_type, a real submitted/in-progress count beats an upcoming
    // placeholder so we never hide a real row.
    const rank = (c: any) => {
      const typeRank = c.period_type === "monthly" ? 2 : c.period_type === "weekly" ? 1 : 0;
      const realRank = c.status === "upcoming" ? 0 : 1;
      return typeRank * 10 + realRank;
    };
    const byKey = new Map<string, any>();
    for (const c of combined) {
      const end = getEffectivePeriodEndDate(c) || c.period_end_date || "";
      const existing = byKey.get(end);
      if (!existing || rank(c) > rank(existing)) {
        byKey.set(end, c);
      }
    }
    const deduped = Array.from(byKey.values());


    const sorted = deduped.sort((a, b) => {
      const aEnd = getEffectivePeriodEndDate(a) || a.period_end_date || "";
      const bEnd = getEffectivePeriodEndDate(b) || b.period_end_date || "";
      return bEnd.localeCompare(aEnd);
    });

    const upcomingSlice = sorted.filter(c => c.status === "upcoming");
    const pastAll = sorted.filter(c => c.status !== "upcoming");
    const pastSlice = pastAll.slice(0, visibleCount);

    return {
      filteredCounts: [...upcomingSlice, ...pastSlice],
      hasMoreHistory: pastAll.length > pastSlice.length,
    };
  }, [completedCounts, typeFilter, upcomingEntries, visibleCount]);

  const safeIdx = Math.min(selectedIdx, Math.max(filteredCounts.length - 1, 0));

  // 4-at-a-time paging
  const PAGE_SIZE = 6;
  const maxPage = Math.max(0, Math.ceil(filteredCounts.length / PAGE_SIZE) - 1);

  useEffect(() => { setSelectedIdx(-1); setPageIndex(0); }, [typeFilter]);

  // Follow the selection into its page so the active tab is always visible.
  useEffect(() => {
    if (safeIdx < 0) return;
    const targetPage = Math.floor(safeIdx / PAGE_SIZE);
    if (targetPage !== pageIndex) setPageIndex(Math.min(targetPage, maxPage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx, maxPage]);

  if (!filteredCounts.length) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No counts yet. Tap “New count” to start your first one.
      </div>
    );
  }


  return (
    <div className="space-y-3">
      {/* Pending incoming transfers */}
      <PendingTransfersSection locationId={locationId} />


      {/* Design D — dark teal hero for current/upcoming + divider list for past periods */}
      {(() => {
        const upcoming = filteredCounts.find(c => c.status === "upcoming") || null;
        const past = filteredCounts.filter(c => c.status !== "upcoming");
        const pagedPast = past.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);
        const pastMaxPage = Math.max(0, Math.ceil(past.length / PAGE_SIZE) - 1);

        // Desktop selection: default to first past row when nothing is explicitly picked.
        const desktopSelectedIdx = safeIdx >= 0
          ? safeIdx
          : past.length > 0 ? filteredCounts.indexOf(past[0]) : -1;
        const desktopSelected = desktopSelectedIdx >= 0 ? filteredCounts[desktopSelectedIdx] : null;

        const renderHero = () => {
          if (!upcoming) return null;
          const endStr = getEffectivePeriodEndDate(upcoming) || upcoming.period_end_date;
          const endDate = new Date(endStr + "T12:00:00");
          const isMonthly = upcoming.period_type === "monthly";
          const periodLabel = isMonthly
            ? `${format(endDate, "MMMM yyyy")} · Month end`
            : `Week ending ${format(endDate, "MMM d")}`;
          const startDate = isMonthly
            ? new Date(endDate.getFullYear(), endDate.getMonth(), 1)
            : (() => { const d = new Date(endDate); d.setDate(d.getDate() - 6); return d; })();
          const rangeLabel = `${format(startDate, "MMM d")} – ${format(endDate, "MMM d")}`;
          const purchases = upcoming._stats?.purchasesTotal;

          return (
            <div className="rounded-xl px-4 py-3 bg-primary text-primary-foreground shadow-sm flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-widest text-primary-foreground/70">
                  Current period
                </div>
                <div className="text-sm font-bold leading-tight truncate">{periodLabel}</div>
                <div className="text-[11px] text-primary-foreground/75 truncate">
                  {rangeLabel}
                  {purchases != null && purchases > 0 && (
                    <> · ${Math.round(purchases).toLocaleString()}</>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={onStartCount}
                className="font-semibold shadow flex-shrink-0 h-8"
              >
                Start count
              </Button>
            </div>
          );
        };

        const renderPastList = ({ desktop }: { desktop: boolean }) => {
          if (past.length === 0) return null;
          return (
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {pagedPast.map((count) => {
                const idx = filteredCounts.indexOf(count);
                const isActive = desktop
                  ? idx === desktopSelectedIdx
                  : idx === safeIdx;
                const effectiveEnd = getEffectivePeriodEndDate(count) || count.period_end_date;
                const endDate = new Date(effectiveEnd + "T12:00:00");
                const isMonthly = count.period_type === "monthly";
                const label = isMonthly
                  ? `${format(endDate, "MMM yyyy")} · Month`
                  : `Week · ${format(endDate, "MMM d")}`;
                const cogsPct: number | null = count._stats?.cogsPct ?? null;
                const ending: number | null = count._stats?.totalCost ?? null;
                const statusLabel = count.status === "in_progress" ? "In progress" : "Submitted";
                const cogsTone =
                  cogsPct == null ? "text-muted-foreground"
                  : cogsPct >= 65 ? "text-red-600"
                  : cogsPct >= 60 ? "text-amber-600"
                  : "text-emerald-600";

                return (
                  <div key={count.id} className="border-b border-border last:border-b-0">
                    <button
                      onClick={() => setSelectedIdx(desktop ? idx : (isActive ? -1 : idx))}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                        isActive
                          ? desktop
                            ? "bg-primary/10 border-l-2 border-primary pl-[14px]"
                            : "bg-muted/40"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold flex items-center gap-1.5">
                          {label}
                          {count.status === "completed" && (
                            <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{statusLabel}</div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {ending != null && ending > 0 && (
                          <span className="text-sm font-semibold text-muted-foreground tabular-nums">
                            ${Math.round(ending).toLocaleString()}
                          </span>
                        )}
                        {cogsPct != null && (
                          <span className={`text-sm font-bold tabular-nums ${cogsTone}`}>
                            {cogsPct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </button>
                    {/* Mobile-only inline expansion */}
                    {!desktop && (
                      <AnimatePresence initial={false}>
                        {isActive && (
                          <motion.div
                            key="panel"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="overflow-hidden"
                          >
                            <div className="px-3 pb-3 pt-1 [&>div>.bg-card]:!border-0 [&>div>.bg-card]:!shadow-none [&>div>.bg-card]:!bg-transparent [&>div>.bg-card]:!rounded-none">
                              {renderResumeBanner(count)}
                              <PeriodDetailPanel
                                count={count}
                                locationId={locationId}
                                onDeleteCount={!count._isUpcoming ? onDeleteCount : undefined}
                                onCreateCountForPeriod={onCreateCountForPeriod}
                                onStartDailyCount={onStartDailyCount}
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    )}
                  </div>
                );
              })}

              {/* Arrow paging — only when more than one page of past periods */}
              {past.length > PAGE_SIZE && (
                <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-t border-border">
                  <button
                    onClick={() => setPageIndex(p => Math.max(0, p - 1))}
                    disabled={pageIndex === 0}
                    className="w-8 h-8 rounded-lg bg-background hover:bg-muted flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-[11px] text-muted-foreground font-medium tabular-nums">
                    {pageIndex + 1} / {pastMaxPage + 1}
                  </span>
                  <button
                    onClick={() => setPageIndex(p => Math.min(pastMaxPage, p + 1))}
                    disabled={pageIndex >= pastMaxPage}
                    className="w-8 h-8 rounded-lg bg-background hover:bg-muted flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          );
        };

        const renderResumeBanner = (count: any) => {
          if (!inProgressWithStats || !(inProgressWithStats._stats?.countedItems > 0) || count.id !== inProgressWithStats.id) return null;
          return (
            <div className="mb-2 flex items-center justify-between px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <div className="flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </div>
                <span className="text-sm font-semibold">
                  {inProgressWithStats._stats.countedItems} of {inProgressWithStats._stats.totalItems} items counted
                </span>
              </div>
              <Button size="sm" onClick={() => navigate(`/inventory/${locationId}/count/${inProgressWithStats.id}?continue=true`)}>
                Resume <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          );
        };

        const loadMore = hasMoreHistory && pageIndex === pastMaxPage ? (
          <div className="flex justify-center">
            <button
              onClick={() => setVisibleCount(v => v + 6)}
              className="text-[11px] font-semibold text-muted-foreground hover:text-foreground px-3 py-1 rounded-full bg-muted/40 hover:bg-muted/70 transition-colors"
            >
              Load older periods
            </button>
          </div>
        ) : null;

        return (
          <div className="space-y-3">
            {/* Mobile / small screens — stacked with inline expansion */}
            <div className="md:hidden space-y-3">
              {renderHero()}
              {renderPastList({ desktop: false })}
              {loadMore}
            </div>

            {/* Tablet / desktop — master-detail split */}
            <div className="hidden md:grid md:grid-cols-12 md:gap-4">
              <div className="md:col-span-5 space-y-3">
                {renderHero()}
                {renderPastList({ desktop: true })}
                {loadMore}
              </div>
              <div className="md:col-span-7">
                {desktopSelected ? (() => {
                  const effEnd = getEffectivePeriodEndDate(desktopSelected) || desktopSelected.period_end_date;
                  const endD = new Date(effEnd + "T12:00:00");
                  const isMonthly = desktopSelected.period_type === "monthly";
                  const headerLabel = isMonthly
                    ? `${format(endD, "MMMM yyyy")} · Month`
                    : `Week ending ${format(endD, "MMM d, yyyy")}`;
                  const cogsPct: number | null = desktopSelected._stats?.cogsPct ?? null;
                  const cogsTone =
                    cogsPct == null ? "text-muted-foreground"
                    : cogsPct >= 65 ? "text-red-600"
                    : cogsPct >= 60 ? "text-amber-600"
                    : "text-emerald-600";
                  return (
                    <div className="rounded-2xl border border-border bg-card p-3 [&>div>.bg-card]:!border-0 [&>div>.bg-card]:!shadow-none [&>div>.bg-card]:!bg-transparent [&>div>.bg-card]:!rounded-none [&>div>.bg-card]:!p-0">
                      <div className="flex items-center justify-between gap-3 px-1 pt-1 pb-2 mb-1 border-b border-border">
                        <div className="text-sm font-bold truncate">{headerLabel}</div>
                        {cogsPct != null && (
                          <div className="flex items-baseline gap-1.5 flex-shrink-0">
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">COGS</span>
                            <span className={`text-base font-bold tabular-nums ${cogsTone}`}>
                              {cogsPct.toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </div>
                      {renderResumeBanner(desktopSelected)}
                      <PeriodDetailPanel
                        count={desktopSelected}
                        locationId={locationId}
                        onDeleteCount={!desktopSelected._isUpcoming ? onDeleteCount : undefined}
                        onCreateCountForPeriod={onCreateCountForPeriod}
                        onStartDailyCount={onStartDailyCount}
                      />
                    </div>
                  );
                })() : (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                    Select a period to see its breakdown.
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      })()}
    </div>
  );
}

// ——— Filter chips ———
function FilterChips({
  typeFilter,
  setTypeFilter,
}: {
  typeFilter: "all" | "weekly" | "monthly";
  setTypeFilter: (v: "all" | "weekly" | "monthly") => void;
}) {
  return (
    <div className="flex gap-1 flex-shrink-0">
      {([
        ["all", "All"],
        ["weekly", "Weekly"],
        ["monthly", "Monthly"],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          onClick={() => setTypeFilter(value as any)}
          className={`px-2.5 md:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            typeFilter === value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

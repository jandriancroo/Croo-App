import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Plus, ArrowRight, ChevronLeft, ChevronRight,
  ArrowRightLeft, Check,
} from "lucide-react";
import { format } from "date-fns";
import { getEffectivePeriodEndDate } from "@/utils/periodLabelUtils";
import { motion, AnimatePresence } from "framer-motion";

import PeriodDetailPanel from "@/components/inventory/PeriodDetailPanel";
import TransferDialog from "@/components/inventory/TransferDialog";
import PendingTransfersSection from "@/components/inventory/PendingTransfersSection";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useInventoryPeriodSettings, computePeriodEndDate } from "@/hooks/useInventoryPeriodSettings";
import { useInventoryTransfers } from "@/hooks/useInventoryTransfers";

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
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(6);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const { pendingIncoming } = useInventoryTransfers(locationId);

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

    // Nearest upcoming monthly: last day of current month if ≥ today, else next month's last day.
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
    let monthEnd = lastOfMonth(y, m);
    if (monthEnd < todayStr) {
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      monthEnd = lastOfMonth(ny, nm);
    }
    if (!allCounts.some(c => c.period_type === "monthly" && c.period_end_date === monthEnd)) {
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

    // Dedupe by effective end date. Real and upcoming live in separate buckets so an
    // upcoming placeholder can never hide a real submitted count for the same date.
    // Within a bucket, monthly wins over weekly on shared dates.
    const byKey = new Map<string, any>();
    for (const c of combined) {
      const end = getEffectivePeriodEndDate(c) || c.period_end_date || "";
      const bucket = c.status === "upcoming" ? "u" : "r";
      const key = `${end}|${bucket}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, c);
      } else if (c.period_type === "monthly" && existing.period_type !== "monthly") {
        byKey.set(key, c);
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
  const selectedCount = filteredCounts[safeIdx] || null;

  // 4-at-a-time paging
  const PAGE_SIZE = 4;
  const maxPage = Math.max(0, Math.ceil(filteredCounts.length / PAGE_SIZE) - 1);
  const pagedCounts = filteredCounts.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => { setSelectedIdx(0); setPageIndex(0); }, [typeFilter]);

  // Follow the selection into its page so the active tab is always visible.
  useEffect(() => {
    const targetPage = Math.floor(safeIdx / PAGE_SIZE);
    if (targetPage !== pageIndex) setPageIndex(Math.min(targetPage, maxPage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx, maxPage]);

  if (!filteredCounts.length) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FilterChips typeFilter={typeFilter} setTypeFilter={setTypeFilter} />
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="h-8 px-3 text-xs gap-1.5" onClick={onStartCount}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="text-center py-12 text-muted-foreground text-sm">No counts yet. Start your first count!</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter chips + New button */}
      <div className="flex items-center gap-2">
        <FilterChips typeFilter={typeFilter} setTypeFilter={setTypeFilter} />
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-8 px-3 text-xs gap-1.5 relative" onClick={() => setShowTransferDialog(true)}>
          <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer
          {pendingIncoming.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">
              {pendingIncoming.length}
            </span>
          )}
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-3 text-xs gap-1.5" onClick={onStartCount}>
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
      </div>

      {/* Pending incoming transfers */}
      <PendingTransfersSection locationId={locationId} />

      <TransferDialog open={showTransferDialog} onClose={() => setShowTransferDialog(false)} locationId={locationId} />

      {/* Flush strip + elevated active tabs */}
      <div>
        <div className="flex items-end gap-1 pt-2" style={{ overflow: "visible" }}>
          <button
            onClick={() => { if (tabsRef.current) tabsRef.current.scrollBy({ left: -200, behavior: "smooth" }); }}
            className="w-7 h-7 rounded-lg bg-muted/60 hover:bg-muted flex items-center justify-center transition-colors flex-shrink-0"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>

          <div ref={tabsRef} className="flex gap-1 flex-1 items-end overflow-x-auto" style={{ scrollbarWidth: "none", msOverflowStyle: "none", paddingTop: 24, marginTop: -24 }}>
            {filteredCounts.map((count, idx) => {
              const isActive = idx === safeIdx;
              const effectiveEnd = getEffectivePeriodEndDate(count) || count.period_end_date;
              const endDate = new Date(effectiveEnd + "T12:00:00");
              const hasCountedItems = (count._stats?.countedItems || 0) > 0;
              const isInProgress = count.status === "in_progress" && hasCountedItems;
              const isCompleted = count.status === "completed";
              const isUpcoming = !!count._isUpcoming || (count.status === "in_progress" && !hasCountedItems);
              const isMonthly = count.period_type === "monthly";

              return (
                <motion.button
                  key={count.id}
                  data-active={isActive}
                  onClick={() => setSelectedIdx(idx)}
                  animate={{
                    height: isActive ? 68 : isMonthly ? 58 : 48,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  className={`
                    flex-shrink-0 transition-colors flex items-center justify-center relative rounded-t-xl
                    ${isActive
                      ? "bg-card text-foreground border-2 border-border border-b-0 shadow-sm -mb-[3px] pb-[3px] z-10 min-w-[108px] px-3"
                      : isMonthly
                        ? "bg-muted/40 text-muted-foreground border border-border/40 border-b-0 min-w-[72px] px-2"
                        : "bg-muted/30 text-muted-foreground border border-border/40 border-b-0 min-w-[80px] px-2 hover:bg-muted/50"
                    }
                  `}
                >
                  {/* Left accent bar for upcoming/in-progress */}
                  {(isUpcoming || isInProgress) && !isActive && (
                    <div className={`absolute left-1.5 top-2 bottom-2 w-[2.5px] rounded-full ${
                      isInProgress ? "bg-amber-400" : "bg-emerald-400"
                    } animate-pulse`} />
                  )}

                  <div className="flex flex-col items-center gap-0.5">
                    <span className={`text-[8px] uppercase font-bold tracking-widest ${
                      isActive ? "text-primary" : "text-muted-foreground/40"
                    }`}>
                      {isMonthly ? "Month" : "Week"}
                    </span>
                    <span className={`text-sm font-bold whitespace-nowrap ${
                      !isActive && isCompleted ? "text-muted-foreground/60" : ""
                    }`}>
                      {isMonthly ? format(endDate, "MMM ''yy") : format(endDate, "MMM d")}
                    </span>
                  </div>
                  {/* Checkmark for completed periods */}
                  {!isActive && isCompleted && (
                    <Check className="absolute top-1 right-1 h-3 w-3 text-emerald-500/60" strokeWidth={3} />
                  )}
                </motion.button>
              );
            })}
          </div>
          <button
            onClick={() => { if (tabsRef.current) tabsRef.current.scrollBy({ left: 200, behavior: "smooth" }); }}
            className="w-7 h-7 rounded-lg bg-muted/60 hover:bg-muted flex items-center justify-center transition-colors flex-shrink-0"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        

        {/* In-progress resume banner (compact, inside detail area) */}
        {inProgressWithStats && (inProgressWithStats._stats?.countedItems > 0) && selectedCount?.id === inProgressWithStats.id && (
          <div className="mt-2 flex items-center justify-between px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
            <div className="flex items-center gap-2">
              <div className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </div>
              <span className="text-sm font-semibold">
                {inProgressWithStats._stats.countedItems} of {inProgressWithStats._stats.totalItems} items counted
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => navigate(`/inventory/${locationId}/count/${inProgressWithStats.id}?continue=true`)}
            >
              Resume <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Detail panel */}
        <AnimatePresence mode="wait">
          {selectedCount && (
            <motion.div
              key={selectedCount.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="period-detail-flush"
            >
              <PeriodDetailPanel
                count={selectedCount}
                locationId={locationId}
                onDeleteCount={!selectedCount._isUpcoming ? onDeleteCount : undefined}
                onCreateCountForPeriod={onCreateCountForPeriod}
                onStartDailyCount={onStartDailyCount}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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

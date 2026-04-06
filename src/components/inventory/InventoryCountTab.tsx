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

  // Compute current weekly period end date using configured end day
  const { getTodayInTimezone } = useLocationTimezone();
  const { config: periodConfig } = useInventoryPeriodSettings(locationId);
  const currentPeriodEntry = useMemo(() => {
    const todayStr = getTodayInTimezone();
    const weekEndStr = computePeriodEndDate(todayStr, periodConfig.periodEndDay);

    const allCounts = recentCounts || [];
    const exists = allCounts.some(
      (c) => c.period_type === "weekly" && c.period_end_date === weekEndStr
    );
    if (exists) return null;

    return {
      id: `_upcoming_weekly_${weekEndStr}`,
      status: "upcoming",
      period_type: "weekly",
      period_end_date: weekEndStr,
      count_date: todayStr,
      _isUpcoming: true,
      _stats: { totalItems: 0, countedItems: 0, totalCost: 0 },
    };
  }, [recentCounts, getTodayInTimezone, periodConfig.periodEndDay]);

  const filteredCounts = useMemo(() => {
    const base = typeFilter === "all"
      ? completedCounts
      : completedCounts.filter((c) => c.period_type === typeFilter);

    const combined = currentPeriodEntry && (typeFilter === "all" || typeFilter === "weekly")
      ? [currentPeriodEntry, ...base]
      : [...base];

    // Sort by effective period_end_date descending (newest first)
    // Uses the monthly close safeguard so ME counts sort by their real month
    return combined.sort((a, b) => {
      const aEnd = getEffectivePeriodEndDate(a) || a.period_end_date || "";
      const bEnd = getEffectivePeriodEndDate(b) || b.period_end_date || "";
      return bEnd.localeCompare(aEnd);
    });
  }, [completedCounts, typeFilter, currentPeriodEntry]);

  const safeIdx = Math.min(selectedIdx, Math.max(filteredCounts.length - 1, 0));
  const selectedCount = filteredCounts[safeIdx] || null;

  useEffect(() => { setSelectedIdx(0); }, [typeFilter]);

  useEffect(() => {
    if (!tabsRef.current) return;
    const el = tabsRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [safeIdx]);

  if (!filteredCounts.length && !currentPeriodEntry) {
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
        <div className="flex items-end gap-1 pt-6">
          <button
            onClick={() => { if (tabsRef.current) tabsRef.current.scrollBy({ left: -200, behavior: "smooth" }); }}
            className="w-7 h-7 rounded-lg bg-muted/60 hover:bg-muted flex items-center justify-center transition-colors flex-shrink-0"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>

          <div ref={tabsRef} className="flex gap-1 overflow-x-auto overflow-y-visible flex-1 items-end" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
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

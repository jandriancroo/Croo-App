import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus, Play, Package, ArrowRight, ChevronLeft, ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

import PeriodDetailPanel from "@/components/inventory/PeriodDetailPanel";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useInventoryPeriodSettings, computePeriodEndDate } from "@/hooks/useInventoryPeriodSettings";

interface InventoryCountTabProps {
  locationId: string;
  inProgressCount: any | null;
  recentCounts: any[] | undefined;
  onStartCount: () => void;
  onDeleteCount: (count: any) => void;
}

// ——— Main component ———
export default function InventoryCountTab({
  locationId,
  inProgressCount,
  recentCounts,
  onStartCount,
  onDeleteCount,
}: InventoryCountTabProps) {
  const [typeFilter, setTypeFilter] = useState<"all" | "weekly" | "monthly">("all");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Merge in-progress stats
  const inProgressWithStats = useMemo(() => {
    if (!inProgressCount) return null;
    const match = recentCounts?.find((c) => c.id === inProgressCount.id);
    return match || { ...inProgressCount, _stats: { totalItems: 0, countedItems: 0, totalCost: 0 } };
  }, [inProgressCount, recentCounts]);

  // All completed + in-progress counts
  const completedCounts = useMemo(
    () => (recentCounts || []).filter((c) => c.status === "completed" || c.status === "in_progress"),
    [recentCounts]
  );

  // Compute current weekly period
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

  // Filtered list
  const filteredCounts = useMemo(() => {
    const base = typeFilter === "all"
      ? completedCounts
      : completedCounts.filter((c) => c.period_type === typeFilter);
    if (currentPeriodEntry && (typeFilter === "all" || typeFilter === "weekly")) {
      return [currentPeriodEntry, ...base];
    }
    return base;
  }, [completedCounts, typeFilter, currentPeriodEntry]);

  // Clamp selected index
  const safeIdx = Math.min(selectedIdx, Math.max(filteredCounts.length - 1, 0));
  const selectedCount = filteredCounts[safeIdx] || null;

  // Reset index when filter changes
  useEffect(() => { setSelectedIdx(0); }, [typeFilter]);

  // Scroll active tab into view
  useEffect(() => {
    if (!tabsRef.current) return;
    const activeTab = tabsRef.current.querySelector('[data-active="true"]');
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [safeIdx]);

  const navigate = useNavigate();

  return (
    <div className="space-y-3">
      {/* Start Count button */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Start Inventory Count</h3>
              <p className="text-muted-foreground text-xs">Select a period and begin counting</p>
            </div>
          </div>
          <Button size="sm" onClick={onStartCount}>
            <Plus className="h-4 w-4 mr-1.5" /> Start Count
          </Button>
        </CardContent>
      </Card>

      {/* In-progress banner */}
      {inProgressWithStats && (inProgressWithStats._stats?.countedItems > 0) && (
        <InProgressBanner count={inProgressWithStats} locationId={locationId} />
      )}

      {/* Tabulated period view */}
      {filteredCounts.length > 0 && (
        <div className="space-y-0">
          {/* Filter chips row */}
          <div className="flex items-center gap-2 mb-2">
            {([
              ["all", "All"],
              ["weekly", "Weekly"],
              ["monthly", "Monthly"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTypeFilter(value as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  typeFilter === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
              </button>
            ))}
            <div className="flex-1" />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {safeIdx + 1} / {filteredCounts.length}
            </span>
          </div>

          {/* Scrollable tab strip */}
          <div className="relative">
            {/* Left fade */}
            <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
            {/* Right fade */}
            <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />

            <div
              ref={tabsRef}
              className="flex gap-1.5 overflow-x-auto scrollbar-hide px-1 py-1 -mx-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {filteredCounts.map((count, idx) => {
                const isActive = idx === safeIdx;
                const isInProgress = count.status === "in_progress";
                return (
                  <button
                    key={count.id}
                    data-active={isActive}
                    onClick={() => setSelectedIdx(idx)}
                    className={`
                      flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl 
                      transition-all duration-200 min-w-[80px] relative border
                      ${isActive
                        ? "bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]"
                        : "bg-card text-foreground border-border/50 hover:bg-muted/60"
                      }
                    `}
                  >
                    {/* Status dot */}
                    {(count._isUpcoming || isInProgress) && (
                      <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${
                        isInProgress ? "bg-amber-400" : "bg-emerald-400"
                      } ${isActive ? "" : "animate-pulse"}`} />
                    )}

                    {/* Period type label */}
                    <span className={`text-[9px] uppercase font-bold tracking-wider ${
                      isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}>
                      {count.period_type === "monthly" ? "Month" : "Week"}
                    </span>

                    {/* Short date */}
                    <span className="text-[13px] font-bold leading-tight whitespace-nowrap">
                      {formatTabLabel(count)}
                    </span>

                    {/* Cost snippet */}
                    {count._stats?.totalCost > 0 && (
                      <span className={`text-[10px] tabular-nums ${
                        isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                      }`}>
                        ${count._stats.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Connector line */}
          <div className="flex justify-center">
            <div className="w-px h-3 bg-border" />
          </div>

          {/* Pagination arrows + card */}
          <div className="relative">
            {/* Nav arrows for mobile swipe alternative */}
            {filteredCounts.length > 1 && (
              <>
                <button
                  onClick={() => setSelectedIdx(Math.max(0, safeIdx - 1))}
                  disabled={safeIdx === 0}
                  className="absolute -left-1 top-4 z-20 w-7 h-7 rounded-full bg-card border border-border/60 shadow-sm flex items-center justify-center disabled:opacity-30 transition-opacity"
                >
                  <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                </button>
                <button
                  onClick={() => setSelectedIdx(Math.min(filteredCounts.length - 1, safeIdx + 1))}
                  disabled={safeIdx === filteredCounts.length - 1}
                  className="absolute -right-1 top-4 z-20 w-7 h-7 rounded-full bg-card border border-border/60 shadow-sm flex items-center justify-center disabled:opacity-30 transition-opacity"
                >
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </>
            )}

            {/* Animated detail card */}
            <AnimatePresence mode="wait">
              {selectedCount && (
                <motion.div
                  key={selectedCount.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  <PeriodDetailPanel
                    count={selectedCount}
                    locationId={locationId}
                    onDeleteCount={!selectedCount._isUpcoming ? onDeleteCount : undefined}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pagination dots */}
            {filteredCounts.length > 1 && filteredCounts.length <= 12 && (
              <div className="flex justify-center gap-1.5 mt-3">
                {filteredCounts.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedIdx(idx)}
                    className={`rounded-full transition-all duration-200 ${
                      idx === safeIdx
                        ? "w-5 h-2 bg-primary"
                        : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ——— Sub-components ———

function InProgressBanner({ count, locationId }: { count: any; locationId: string }) {
  const navigate = useNavigate();
  const stats = count._stats || { totalItems: 0, countedItems: 0 };
  const pct = stats.totalItems > 0 ? Math.round((stats.countedItems / stats.totalItems) * 100) : 0;
  const shortLabel = formatPeriodShort(count);
  const hasStarted = stats.countedItems > 0;

  return (
    <Card className="border-primary/30 bg-primary/5 overflow-hidden">
      <CardContent className="p-4 pb-12 relative">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center relative flex-shrink-0">
            <Play className="h-5 w-5 text-primary" />
            {hasStarted && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
              </span>
            )}
          </div>
          <div>
            <p className="text-base font-bold">
              {shortLabel} — {hasStarted ? "In Progress" : "Ready to Count"}
            </p>
            {hasStarted && (
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm text-muted-foreground">
                  {stats.countedItems} of {stats.totalItems} items
                </span>
                <div className="w-24 bg-muted rounded-full h-2">
                  <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
        <Button
          size="sm"
          className="absolute bottom-3 right-3 flex-shrink-0"
          onClick={() => navigate(`/inventory/${locationId}/count/${count.id}?continue=true`)}
        >
          {hasStarted ? "Resume" : "Start"} <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ——— Helpers ———

function formatTabLabel(count: any): string {
  if (!count.period_type || !count.period_end_date) {
    return format(new Date(count.count_date + "T12:00:00"), "MMM d");
  }
  const endDate = new Date(count.period_end_date + "T12:00:00");
  switch (count.period_type) {
    case "weekly":
      return format(endDate, "MMM d");
    case "monthly":
      return format(endDate, "MMM ''yy");
    default:
      return format(endDate, "MMM d");
  }
}

function formatPeriodShort(count: any): string {
  if (!count.period_type || !count.period_end_date) {
    return format(new Date(count.count_date + "T12:00:00"), "MMM d, yyyy");
  }
  const endDate = new Date(count.period_end_date + "T12:00:00");
  switch (count.period_type) {
    case "weekly":
      return `Week Ending ${format(endDate, "MMM d")}`;
    case "monthly":
      return `ME ${format(endDate, "MMM ''yy")}`;
    case "yearly":
      return `YE ${format(endDate, "yyyy")}`;
    default:
      return format(new Date(count.count_date + "T12:00:00"), "MMM d");
  }
}

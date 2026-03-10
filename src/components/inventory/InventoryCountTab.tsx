import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus, Play, Package,
  Calendar, ChevronDown, ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import DailySpotCount from "@/components/inventory/DailySpotCount";
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

// ——— In-progress banner ———
function InProgressBanner({
  count,
  locationId,
}: {
  count: any;
  locationId: string;
}) {
  const navigate = useNavigate();
  const stats = count._stats || { totalItems: 0, countedItems: 0 };
  const pct = stats.totalItems > 0 ? Math.round((stats.countedItems / stats.totalItems) * 100) : 0;

  const shortLabel = formatPeriodShort(count);

  return (
    <Card className="border-primary/30 bg-primary/5 overflow-hidden">
      <CardContent className="p-4 pb-12 relative">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center relative flex-shrink-0">
            <Play className="h-5 w-5 text-primary" />
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
            </span>
          </div>
          <div>
            <p className="text-base font-bold">{shortLabel} — In Progress</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-muted-foreground">
                {stats.countedItems} of {stats.totalItems} items
              </span>
              <div className="w-24 bg-muted rounded-full h-2">
                <div
                  className="bg-primary rounded-full h-2 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        </div>
        <Button
          size="sm"
          className="absolute bottom-3 right-3 flex-shrink-0"
          onClick={() =>
            navigate(`/inventory/${locationId}/count/${count.id}?continue=true`)
          }
        >
          Resume <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}

// PeriodDetailPanel is now imported from ./PeriodDetailPanel

// ——— Main component ———
export default function InventoryCountTab({
  locationId,
  inProgressCount,
  recentCounts,
  onStartCount,
  onDeleteCount,
}: InventoryCountTabProps) {
  const [typeFilter, setTypeFilter] = useState<"all" | "weekly" | "monthly">(
    "all"
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Merge in-progress into recentCounts stats if available
  const inProgressWithStats = useMemo(() => {
    if (!inProgressCount) return null;
    const match = recentCounts?.find((c) => c.id === inProgressCount.id);
    return match || { ...inProgressCount, _stats: { totalItems: 0, countedItems: 0, totalCost: 0 } };
  }, [inProgressCount, recentCounts]);

  // Completed + in-progress counts for the dropdown
  const completedCounts = useMemo(
    () =>
      (recentCounts || []).filter((c) => c.status === "completed" || c.status === "in_progress"),
    [recentCounts]
  );

  // Compute current weekly period end date using configured end day
  const { getTodayInTimezone } = useLocationTimezone();
  const { config: periodConfig } = useInventoryPeriodSettings(locationId);
  const currentPeriodEntry = useMemo(() => {
    const todayStr = getTodayInTimezone();
    const weekEndStr = computePeriodEndDate(todayStr, periodConfig.periodEndDay);

    // Check if any count (completed or in-progress) already covers this period
    const allCounts = recentCounts || [];
    const exists = allCounts.some(
      (c) => c.period_type === "weekly" && c.period_end_date === weekEndStr
    );
    if (exists) return null;

    // Return a virtual entry
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

    // Prepend current period if it matches the filter and exists
    if (currentPeriodEntry && (typeFilter === "all" || typeFilter === "weekly")) {
      return [currentPeriodEntry, ...base];
    }
    return base;
  }, [completedCounts, typeFilter, currentPeriodEntry]);

  // Auto-select first completed count if none selected
  const effectiveSelectedId = selectedId && filteredCounts.some((c) => c.id === selectedId)
    ? selectedId
    : filteredCounts[0]?.id || null;

  const selectedCount = filteredCounts.find((c) => c.id === effectiveSelectedId);

  return (
    <div className="space-y-4">
      {/* Start Count */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Start Inventory Count</h3>
              <p className="text-muted-foreground text-xs">
                Select a period and begin counting
              </p>
            </div>
          </div>
          <Button size="sm" onClick={onStartCount}>
            <Plus className="h-4 w-4 mr-1.5" />
            Start Count
          </Button>
        </CardContent>
      </Card>

      {/* In-progress banner */}
      {inProgressWithStats && (
        <InProgressBanner
          count={inProgressWithStats}
          locationId={locationId}
        />
      )}

      {/* Daily Spot Check */}
      <DailySpotCount locationId={locationId} />

      {/* Period selector: filter chips + dropdown */}
      {(completedCounts.length > 0 || currentPeriodEntry) && (
        <>
          <div className="flex items-center gap-2">
            {/* Filter chips */}
            <div className="flex gap-1 flex-shrink-0">
              {(
                [
                  ["all", "All", "All"],
                  ["weekly", "Wk", "Weekly"],
                  ["monthly", "Mo", "Monthly"],
                ] as const
              ).map(([value, mobileLabel, desktopLabel]) => (
                <button
                  key={value}
                  onClick={() => setTypeFilter(value as any)}
                  className={`px-2.5 md:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    typeFilter === value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <span className="md:hidden">{mobileLabel}</span>
                  <span className="hidden md:inline">{desktopLabel}</span>
                </button>
              ))}
            </div>

            {/* Period dropdown */}
            <div className="relative flex-1">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl bg-card border border-border/50 hover:bg-muted/40 transition-all"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-bold truncate">
                    {selectedCount
                      ? formatPeriodShort(selectedCount)
                      : "Select period"}
                  </span>
                  {selectedCount?._isUpcoming && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 h-4 uppercase flex-shrink-0 border-primary/40 text-primary"
                    >
                      Current
                    </Badge>
                  )}
                  {selectedCount?.period_type === "monthly" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 h-4 uppercase flex-shrink-0"
                    >
                      Mo
                    </Badge>
                  )}
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 ml-1 ${
                    dropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute z-50 top-full mt-1 left-0 right-0 bg-card border border-border/60 rounded-2xl shadow-lg overflow-hidden max-h-80 overflow-y-auto"
                  >
                    {filteredCounts.map((count) => (
                      <button
                        key={count.id}
                        onClick={() => {
                          setSelectedId(count.id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 flex items-center justify-between transition-all ${
                          effectiveSelectedId === count.id
                            ? "bg-primary/10"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">
                            {formatPeriodShort(count)}
                          </span>
                          {count._isUpcoming && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-4 uppercase border-primary/40 text-primary"
                            >
                              Current
                            </Badge>
                          )}
                          {count.is_late_close && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-4 uppercase border-amber-500/50 text-amber-600"
                            >
                              Late
                            </Badge>
                          )}
                          {count.period_type === "monthly" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-4 uppercase"
                            >
                              Monthly
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {count._stats?.totalCost > 0 && (
                            <span className="text-xs text-muted-foreground">
                              $
                              {count._stats.totalCost.toLocaleString(
                                undefined,
                                {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                }
                              )}
                            </span>
                          )}
                          <Badge
                            variant="secondary"
                            className="text-xs px-2"
                          >
                            {count._stats?.countedItems || 0}/
                            {count._stats?.totalItems || 0}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Detail panel for selected period */}
          {selectedCount && (
            <PeriodDetailPanel
              count={selectedCount}
              locationId={locationId}
              onDeleteCount={!selectedCount._isUpcoming ? onDeleteCount : undefined}
            />
          )}
        </>
      )}
    </div>
  );
}

// ——— Helpers ———

function formatPeriodLabel(count: any): string {
  if (!count.period_type || !count.period_end_date) {
    return format(
      new Date(count.count_date + "T12:00:00"),
      "MMM d, yyyy"
    );
  }
  const endDate = new Date(count.period_end_date + "T12:00:00");
  switch (count.period_type) {
    case "weekly":
      return `Week Ending ${format(endDate, "MMM d, yyyy")}`;
    case "monthly":
      return `${format(endDate, "MMMM yyyy")} Month End`;
    case "yearly":
      return `${format(endDate, "yyyy")} Year End`;
    default:
      return format(new Date(count.count_date + "T12:00:00"), "MMM d, yyyy");
  }
}

function formatPeriodShort(count: any): string {
  if (!count.period_type || !count.period_end_date) {
    return format(
      new Date(count.count_date + "T12:00:00"),
      "MMM d, yyyy"
    );
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

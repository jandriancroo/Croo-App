import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus, Play, Package, ArrowRight, ChevronLeft, ChevronRight,
  DollarSign, CheckCircle2, Clock, BarChart3, ArrowLeft,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

// ——— Mock data ———
const MOCK_COUNTS = [
  {
    id: "current-week",
    status: "upcoming",
    period_type: "weekly",
    period_end_date: "2026-03-17",
    count_date: "2026-03-16",
    _isUpcoming: true,
    _stats: { totalItems: 202, countedItems: 0, totalCost: 0 },
  },
  {
    id: "week-mar-10",
    status: "in_progress",
    period_type: "weekly",
    period_end_date: "2026-03-10",
    count_date: "2026-03-10",
    _stats: { totalItems: 202, countedItems: 167, totalCost: 14230 },
  },
  {
    id: "week-mar-3",
    status: "completed",
    period_type: "weekly",
    period_end_date: "2026-03-03",
    count_date: "2026-03-03",
    _stats: { totalItems: 202, countedItems: 202, totalCost: 13870 },
  },
  {
    id: "me-feb",
    status: "completed",
    period_type: "monthly",
    period_end_date: "2026-02-28",
    count_date: "2026-02-28",
    _stats: { totalItems: 202, countedItems: 202, totalCost: 15420 },
  },
  {
    id: "week-feb-24",
    status: "completed",
    period_type: "weekly",
    period_end_date: "2026-02-24",
    count_date: "2026-02-24",
    _stats: { totalItems: 198, countedItems: 198, totalCost: 12980 },
  },
  {
    id: "week-feb-17",
    status: "completed",
    period_type: "weekly",
    period_end_date: "2026-02-17",
    count_date: "2026-02-17",
    _stats: { totalItems: 198, countedItems: 198, totalCost: 13150 },
  },
  {
    id: "week-feb-10",
    status: "completed",
    period_type: "weekly",
    period_end_date: "2026-02-10",
    count_date: "2026-02-10",
    _stats: { totalItems: 195, countedItems: 195, totalCost: 12640 },
  },
  {
    id: "week-feb-3",
    status: "completed",
    period_type: "weekly",
    period_end_date: "2026-02-03",
    count_date: "2026-02-03",
    _stats: { totalItems: 195, countedItems: 195, totalCost: 12200 },
  },
  {
    id: "me-jan",
    status: "completed",
    period_type: "monthly",
    period_end_date: "2026-01-31",
    count_date: "2026-01-31",
    _stats: { totalItems: 195, countedItems: 195, totalCost: 14800 },
  },
];

export default function CountTabPreview() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Count Tab — Layout Preview</h1>
      </div>

      <div className="p-4 max-w-lg mx-auto">
        <CountTabConcept />
      </div>
    </div>
  );
}

function CountTabConcept() {
  const [typeFilter, setTypeFilter] = useState<"all" | "weekly" | "monthly">("all");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  const filteredCounts = useMemo(() => {
    if (typeFilter === "all") return MOCK_COUNTS;
    return MOCK_COUNTS.filter((c) => c.period_type === typeFilter);
  }, [typeFilter]);

  const safeIdx = Math.min(selectedIdx, Math.max(filteredCounts.length - 1, 0));
  const selectedCount = filteredCounts[safeIdx] || null;

  useEffect(() => { setSelectedIdx(0); }, [typeFilter]);

  // Scroll active tab into view
  useEffect(() => {
    if (!tabsRef.current) return;
    const activeTab = tabsRef.current.querySelector('[data-active="true"]');
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [safeIdx]);

  const pct = selectedCount
    ? selectedCount._stats.totalItems > 0
      ? Math.round((selectedCount._stats.countedItems / selectedCount._stats.totalItems) * 100)
      : 0
    : 0;

  return (
    <div className="space-y-3">
      {/* Start Count card */}
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
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1.5" /> New
          </Button>
        </CardContent>
      </Card>

      {/* Filter chips + counter */}
      <div className="flex items-center gap-2">
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
        <span className="text-[11px] text-muted-foreground font-medium tabular-nums">
          {safeIdx + 1} of {filteredCounts.length}
        </span>
      </div>

      {/* ——— Scrollable tab strip ——— */}
      <div className="relative">
        {/* Edge fades */}
        <div className="absolute left-0 top-0 bottom-0 w-5 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none rounded-l-xl" />
        <div className="absolute right-0 top-0 bottom-0 w-5 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none rounded-r-xl" />

        <div
          ref={tabsRef}
          className="flex gap-1.5 overflow-x-auto px-1 py-1 -mx-1"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {filteredCounts.map((count, idx) => {
            const isActive = idx === safeIdx;
            const isInProgress = count.status === "in_progress";
            const endDate = new Date(count.period_end_date + "T12:00:00");

            return (
              <button
                key={count.id}
                data-active={isActive}
                onClick={() => setSelectedIdx(idx)}
                className={`
                  flex-shrink-0 flex flex-col items-center gap-0.5 px-3.5 py-2.5 rounded-xl
                  transition-all duration-200 min-w-[76px] relative border
                  ${isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-md scale-[1.03]"
                    : "bg-card text-foreground border-border/40 hover:border-border hover:bg-muted/40"
                  }
                `}
              >
                {/* Status indicator */}
                {(count._isUpcoming || isInProgress) && (
                  <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${
                    isInProgress ? "bg-amber-400" : "bg-emerald-400"
                  } ${!isActive ? "animate-pulse" : ""}`} />
                )}

                {/* Type */}
                <span className={`text-[9px] uppercase font-bold tracking-widest leading-none ${
                  isActive ? "text-primary-foreground/60" : "text-muted-foreground"
                }`}>
                  {count.period_type === "monthly" ? "Month" : "Week"}
                </span>

                {/* Date */}
                <span className="text-[13px] font-bold leading-tight whitespace-nowrap">
                  {count.period_type === "monthly"
                    ? format(endDate, "MMM ''yy")
                    : format(endDate, "MMM d")}
                </span>

                {/* Cost */}
                {count._stats.totalCost > 0 && (
                  <span className={`text-[10px] tabular-nums leading-none ${
                    isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                  }`}>
                    ${(count._stats.totalCost / 1000).toFixed(1)}k
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ——— Connected detail card ——— */}
      <div className="relative">
        {/* Connector */}
        <div className="flex justify-center -mt-1 mb-0">
          <div className="w-px h-3 bg-border" />
        </div>

        {/* Nav arrows */}
        {filteredCounts.length > 1 && (
          <>
            <button
              onClick={() => setSelectedIdx(Math.max(0, safeIdx - 1))}
              disabled={safeIdx === 0}
              className="absolute -left-2 top-12 z-20 w-8 h-8 rounded-full bg-card border border-border/50 shadow-sm flex items-center justify-center disabled:opacity-20 transition-opacity"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => setSelectedIdx(Math.min(filteredCounts.length - 1, safeIdx + 1))}
              disabled={safeIdx === filteredCounts.length - 1}
              className="absolute -right-2 top-12 z-20 w-8 h-8 rounded-full bg-card border border-border/50 shadow-sm flex items-center justify-center disabled:opacity-20 transition-opacity"
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </>
        )}

        {/* Detail card */}
        <AnimatePresence mode="wait">
          {selectedCount && (
            <motion.div
              key={selectedCount.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <Card className="overflow-hidden">
                {/* Card header with period info */}
                <div className="px-4 pt-4 pb-3 border-b border-border/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold">
                          {selectedCount.period_type === "weekly"
                            ? `Week Ending ${format(new Date(selectedCount.period_end_date + "T12:00:00"), "MMM d, yyyy")}`
                            : `${format(new Date(selectedCount.period_end_date + "T12:00:00"), "MMMM yyyy")} Month End`
                          }
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <StatusBadge status={selectedCount.status} isUpcoming={!!selectedCount._isUpcoming} />
                        {selectedCount._stats.countedItems > 0 && selectedCount._stats.countedItems < selectedCount._stats.totalItems && (
                          <span className="text-xs text-muted-foreground">{pct}% complete</span>
                        )}
                      </div>
                    </div>

                    {/* Action button */}
                    {selectedCount.status === "in_progress" && (
                      <Button size="sm">
                        Resume <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}
                    {selectedCount._isUpcoming && (
                      <Button size="sm" variant="outline">
                        Start <Play className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    )}
                  </div>

                  {/* Progress bar for in-progress */}
                  {selectedCount.status === "in_progress" && (
                    <div className="mt-3">
                      <div className="w-full bg-muted rounded-full h-2">
                        <motion.div
                          className="bg-primary rounded-full h-2"
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Stats grid */}
                <CardContent className="p-4">
                  <div className="grid grid-cols-3 gap-3">
                    <StatCell
                      icon={<CheckCircle2 className="h-4 w-4" />}
                      label="Items"
                      value={`${selectedCount._stats.countedItems}/${selectedCount._stats.totalItems}`}
                      accent={selectedCount._stats.countedItems === selectedCount._stats.totalItems && selectedCount._stats.totalItems > 0}
                    />
                    <StatCell
                      icon={<DollarSign className="h-4 w-4" />}
                      label="Total Value"
                      value={selectedCount._stats.totalCost > 0
                        ? `$${selectedCount._stats.totalCost.toLocaleString()}`
                        : "—"
                      }
                    />
                    <StatCell
                      icon={<BarChart3 className="h-4 w-4" />}
                      label="Variance"
                      value={selectedCount.status === "completed" ? "-2.1%" : "—"}
                      negative={selectedCount.status === "completed"}
                    />
                  </div>

                  {/* Quick actions */}
                  {selectedCount.status === "completed" && (
                    <div className="flex gap-2 mt-4">
                      <Button size="sm" variant="outline" className="flex-1 text-xs">
                        View Details
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-xs">
                        COGS Report
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pagination dots */}
        {filteredCounts.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-3">
            {filteredCounts.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedIdx(idx)}
                className={`rounded-full transition-all duration-200 ${
                  idx === safeIdx
                    ? "w-5 h-1.5 bg-primary"
                    : "w-1.5 h-1.5 bg-muted-foreground/25 hover:bg-muted-foreground/40"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ——— Small components ———

function StatusBadge({ status, isUpcoming }: { status: string; isUpcoming: boolean }) {
  if (isUpcoming) {
    return (
      <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
        Current
      </Badge>
    );
  }
  if (status === "in_progress") {
    return (
      <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-amber-500/40 text-amber-600 bg-amber-500/5">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5" />
        In Progress
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-border text-muted-foreground">
      <CheckCircle2 className="h-3 w-3 mr-1" />
      Complete
    </Badge>
  );
}

function StatCell({
  icon,
  label,
  value,
  accent,
  negative,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-muted/40 border border-border/20">
      <div className={`${accent ? "text-emerald-500" : negative ? "text-red-500" : "text-muted-foreground"}`}>
        {icon}
      </div>
      <span className={`text-sm font-bold tabular-nums ${accent ? "text-emerald-600" : negative ? "text-red-500" : ""}`}>
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}

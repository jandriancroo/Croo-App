import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus, Play, Package, ArrowRight, ChevronLeft, ChevronRight,
  DollarSign, CheckCircle2, BarChart3, ArrowLeft,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

// ——— Mock data ———
const MOCK_COUNTS = [
  { id: "current-week", status: "upcoming", period_type: "weekly", period_end_date: "2026-03-17", count_date: "2026-03-16", _isUpcoming: true, _stats: { totalItems: 202, countedItems: 0, totalCost: 0, cogsPct: null } },
  { id: "week-mar-10", status: "in_progress", period_type: "weekly", period_end_date: "2026-03-10", count_date: "2026-03-10", _stats: { totalItems: 202, countedItems: 167, totalCost: 14230, cogsPct: null } },
  { id: "week-mar-3", status: "completed", period_type: "weekly", period_end_date: "2026-03-03", count_date: "2026-03-03", _stats: { totalItems: 202, countedItems: 202, totalCost: 13870, cogsPct: 21.4 } },
  { id: "me-feb", status: "completed", period_type: "monthly", period_end_date: "2026-02-28", count_date: "2026-02-28", _stats: { totalItems: 202, countedItems: 202, totalCost: 15420, cogsPct: 22.1 } },
  { id: "week-feb-24", status: "completed", period_type: "weekly", period_end_date: "2026-02-24", count_date: "2026-02-24", _stats: { totalItems: 198, countedItems: 198, totalCost: 12980, cogsPct: 20.8 } },
  { id: "week-feb-17", status: "completed", period_type: "weekly", period_end_date: "2026-02-17", count_date: "2026-02-17", _stats: { totalItems: 198, countedItems: 198, totalCost: 13150, cogsPct: 23.1 } },
  { id: "week-feb-10", status: "completed", period_type: "weekly", period_end_date: "2026-02-10", count_date: "2026-02-10", _stats: { totalItems: 195, countedItems: 195, totalCost: 12640, cogsPct: 21.7 } },
  { id: "week-feb-3", status: "completed", period_type: "weekly", period_end_date: "2026-02-03", count_date: "2026-02-03", _stats: { totalItems: 195, countedItems: 195, totalCost: 12200, cogsPct: 22.4 } },
  { id: "me-jan", status: "completed", period_type: "monthly", period_end_date: "2026-01-31", count_date: "2026-01-31", _stats: { totalItems: 195, countedItems: 195, totalCost: 14800, cogsPct: 21.9 } },
];

export default function CountTabPreview() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Count Tab — Notch Tab Preview</h1>
      </div>

      <div className="p-4 max-w-lg mx-auto">
        <NotchTabConcept />
      </div>
    </div>
  );
}

function NotchTabConcept() {
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

  useEffect(() => {
    if (!tabsRef.current) return;
    const el = tabsRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [safeIdx]);

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
          <Button size="sm"><Plus className="h-4 w-4 mr-1.5" /> New</Button>
        </CardContent>
      </Card>

      {/* Filter chips + counter */}
      <div className="flex items-center gap-2">
        {([["all", "All"], ["weekly", "Weekly"], ["monthly", "Monthly"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTypeFilter(v as any)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              typeFilter === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}>{l}</button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (tabsRef.current) tabsRef.current.scrollBy({ left: -200, behavior: "smooth" });
            }}
            className="w-7 h-7 rounded-lg bg-muted/60 hover:bg-muted flex items-center justify-center transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="text-[11px] text-muted-foreground font-medium tabular-nums min-w-[3ch] text-center">{safeIdx + 1}/{filteredCounts.length}</span>
          <button
            onClick={() => {
              if (tabsRef.current) tabsRef.current.scrollBy({ left: 200, behavior: "smooth" });
            }}
            className="w-7 h-7 rounded-lg bg-muted/60 hover:bg-muted flex items-center justify-center transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Notch tabs + detail card */}
      <div>
        {/* Tab strip */}
        <div ref={tabsRef} className="flex gap-1.5 overflow-x-auto pb-0" style={{
          scrollbarWidth: "none", msOverflowStyle: "none",
        }}>
          {filteredCounts.map((count, idx) => {
            const isActive = idx === safeIdx;
            const endDate = new Date(count.period_end_date + "T12:00:00");
            const isInProgress = count.status === "in_progress";
            const isCompleted = count.status === "completed";

            return (
              <div key={count.id} className="flex flex-col items-center" data-active={isActive}
                style={{ minWidth: "calc((100% - 3 * 0.375rem) / 4)", flex: "0 0 calc((100% - 3 * 0.375rem) / 4)" }}>
                <button
                  onClick={() => setSelectedIdx(idx)}
                  className={`
                    w-full py-2.5 rounded-xl border transition-all duration-200 relative overflow-hidden
                    ${isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : isCompleted
                        ? "bg-muted/60 text-muted-foreground border-border/30"
                        : "bg-card text-foreground border-border/40 hover:bg-muted/40 hover:border-border"
                    }
                  `}
                >
                  {/* Completed checkmark */}
                  {isCompleted && !isActive && (
                    <span className="absolute top-1 right-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
                    </span>
                  )}

                  {/* Status dot for upcoming/in-progress */}
                  {count._isUpcoming && (
                    <span className={`absolute top-1 right-1 h-2 w-2 rounded-full bg-emerald-400 ${!isActive ? "animate-pulse" : ""}`} />
                  )}
                  {isInProgress && (
                    <span className={`absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 ${!isActive ? "animate-pulse" : ""}`} />
                  )}

                  <div className="flex flex-col items-center gap-0.5">
                    <span className={`text-[8px] uppercase font-bold tracking-widest leading-none ${
                      isActive ? "text-primary-foreground/60" : "text-muted-foreground"
                    }`}>
                      {count.period_type === "monthly" ? "Month" : "Week"}
                    </span>
                    <span className={`text-[12px] font-bold leading-tight whitespace-nowrap ${
                      isCompleted && !isActive ? "text-muted-foreground" : ""
                    }`}>
                      {count.period_type === "monthly" ? format(endDate, "MMM ''yy") : format(endDate, "MMM d")}
                    </span>
                    {count._stats.cogsPct != null ? (
                      <span className={`text-[9px] tabular-nums font-semibold leading-none ${
                        isActive ? "text-primary-foreground/70"
                          : count._stats.cogsPct <= 22 ? "text-emerald-600/70" : "text-amber-600/70"
                      }`}>
                        {count._stats.cogsPct}%
                      </span>
                    ) : count._stats.totalCost > 0 ? (
                      <span className={`text-[9px] tabular-nums leading-none ${
                        isActive ? "text-primary-foreground/70" : "text-muted-foreground/70"
                      }`}>
                        ${(count._stats.totalCost / 1000).toFixed(1)}k
                      </span>
                    ) : null}
                  </div>
                </button>

                {/* Notch arrow — only on active */}
                {isActive ? (
                  <div className="w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-primary -mb-px relative z-10" />
                ) : (
                  <div className="h-[8px]" />
                )}
              </div>
            );
          })}
        </div>

        {/* Detail card */}
        <AnimatePresence mode="wait">
          {selectedCount && (
            <motion.div
              key={selectedCount.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              <Card>
                <DetailCardContent count={selectedCount} />
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ——— Detail card content ———
function DetailCardContent({ count }: { count: any }) {
  const pct = count._stats.totalItems > 0
    ? Math.round((count._stats.countedItems / count._stats.totalItems) * 100)
    : 0;

  return (
    <>
      <div className="px-4 pt-4 pb-3 border-b border-border/20">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">
              {count.period_type === "weekly"
                ? `Week Ending ${format(new Date(count.period_end_date + "T12:00:00"), "MMM d, yyyy")}`
                : `${format(new Date(count.period_end_date + "T12:00:00"), "MMMM yyyy")} Month End`}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={count.status} isUpcoming={!!count._isUpcoming} />
              {count.status === "in_progress" && (
                <span className="text-xs text-muted-foreground">{pct}% complete</span>
              )}
            </div>
          </div>

          {count.status === "in_progress" && (
            <Button size="sm">Resume <ArrowRight className="h-4 w-4 ml-1" /></Button>
          )}
          {count._isUpcoming && (
            <Button size="sm" variant="outline">Start <Play className="h-3.5 w-3.5 ml-1" /></Button>
          )}
        </div>

        {count.status === "in_progress" && (
          <div className="mt-3 w-full bg-muted rounded-full h-2">
            <motion.div
              className="bg-primary rounded-full h-2"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCell
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Items"
            value={`${count._stats.countedItems}/${count._stats.totalItems}`}
            accent={count._stats.countedItems === count._stats.totalItems && count._stats.totalItems > 0}
          />
          <StatCell
            icon={<DollarSign className="h-4 w-4" />}
            label="Total Value"
            value={count._stats.totalCost > 0 ? `$${count._stats.totalCost.toLocaleString()}` : "—"}
          />
          <StatCell
            icon={<BarChart3 className="h-4 w-4" />}
            label="Variance"
            value={count.status === "completed" ? "-2.1%" : "—"}
            negative={count.status === "completed"}
          />
        </div>

        {count.status === "completed" && (
          <div className="flex gap-2 mt-4">
            <Button size="sm" variant="outline" className="flex-1 text-xs">View Details</Button>
            <Button size="sm" variant="outline" className="flex-1 text-xs">COGS Report</Button>
          </div>
        )}
      </div>
    </>
  );
}

// ——— Small components ———
function StatusBadge({ status, isUpcoming }: { status: string; isUpcoming: boolean }) {
  if (isUpcoming) return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" /> Current
    </Badge>
  );
  if (status === "in_progress") return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-amber-500/40 text-amber-600 bg-amber-500/5">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5" /> In Progress
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-border text-muted-foreground">
      <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
    </Badge>
  );
}

function StatCell({ icon, label, value, accent, negative }: {
  icon: React.ReactNode; label: string; value: string; accent?: boolean; negative?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-muted/40 border border-border/20">
      <div className={accent ? "text-emerald-500" : negative ? "text-red-500" : "text-muted-foreground"}>{icon}</div>
      <span className={`text-sm font-bold tabular-nums ${accent ? "text-emerald-600" : negative ? "text-red-500" : ""}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}

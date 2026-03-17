import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus, Play, Package, ArrowRight, ChevronLeft, ChevronRight,
  DollarSign, CheckCircle2, BarChart3, ArrowLeft, ClipboardCheck,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

                  {/* Left accent bar for upcoming/in-progress */}
                  {(count._isUpcoming || isInProgress) && (
                    <div className={`absolute left-1.5 top-3 bottom-3 w-[2.5px] rounded-full ${
                      isInProgress ? "bg-amber-400" : "bg-emerald-400"
                    } ${!isActive ? "animate-pulse" : ""}`} />
                  )}

                  <div className="flex flex-col items-center gap-0.5 min-h-[40px] justify-center">
                    <span className={`text-[8px] uppercase font-bold tracking-widest leading-none ${
                      isActive ? "text-primary-foreground/60" : "text-muted-foreground"
                    }`}>
                      {count.period_type === "monthly" ? "Mo. Ending" : "Wk Ending"}
                    </span>
                    <span className={`text-[12px] font-bold leading-tight whitespace-nowrap ${
                      isCompleted && !isActive ? "text-muted-foreground" : ""
                    }`}>
                      {count.period_type === "monthly" ? format(endDate, "MMM ''yy") : format(endDate, "MMM d")}
                    </span>
                    <span className={`text-[9px] tabular-nums font-semibold leading-none h-[11px] ${
                      count._stats.cogsPct != null
                        ? (isActive ? "text-primary-foreground/70"
                            : count._stats.cogsPct <= 22 ? "text-emerald-600/70" : "text-amber-600/70")
                        : count._stats.totalCost > 0
                          ? (isActive ? "text-primary-foreground/70" : "text-muted-foreground/70")
                          : "invisible"
                    }`}>
                      {count._stats.cogsPct != null
                        ? `${count._stats.cogsPct}%`
                        : count._stats.totalCost > 0
                          ? `$${(count._stats.totalCost / 1000).toFixed(1)}k`
                          : "—"}
                    </span>
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

        {/* Daily Spot Counts within this period */}
        {count.period_type === "weekly" && (
          <DailyCountsSection periodEndDate={count.period_end_date} />
        )}
      </div>
    </>
  );
}

// ——— Daily Counts Section ———
const DAY_INITIALS: Record<number, string> = { 0: "Su", 1: "M", 2: "T", 3: "W", 4: "T", 5: "F", 6: "S" };

// Mock daily count detail data
const MOCK_DAILY_ITEMS = [
  { name: "Chicken Breast", expected: 12, counted: 11, unit: "lbs" },
  { name: "Brisket", expected: 8, counted: 8, unit: "lbs" },
  { name: "Pulled Pork", expected: 6, counted: 5, unit: "pans" },
  { name: "Mac & Cheese", expected: 4, counted: 4, unit: "pans" },
  { name: "Coleslaw", expected: 3, counted: 3, unit: "pans" },
  { name: "Baked Beans", expected: 3, counted: 2, unit: "pans" },
  { name: "Cornbread", expected: 24, counted: 24, unit: "pcs" },
  { name: "Banana Pudding", expected: 4, counted: 4, unit: "pans" },
];

function DailyCountsSection({ periodEndDate, periodStartDate }: { periodEndDate: string; periodStartDate?: string }) {
  const [previewDay, setPreviewDay] = useState<string | null>(null);
  const endDate = new Date(periodEndDate + "T12:00:00");
  const today = format(new Date(), "yyyy-MM-dd");

  // Calculate start date: use provided start or default to 6 days before end (standard 7-day week)
  const startDate = periodStartDate
    ? new Date(periodStartDate + "T12:00:00")
    : (() => { const d = new Date(endDate); d.setDate(d.getDate() - 6); return d; })();

  // Build dynamic day array based on actual period range
  const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const days = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return { date: d, key: format(d, "yyyy-MM-dd"), label: DAY_INITIALS[d.getDay()] };
  });

  const completedDays = new Set([days[0].key, days[1].key, days[2].key, days[4].key]);
  const completedCount = days.filter((d) => completedDays.has(d.key)).length;

  return (
    <div className="mt-4 pt-3 border-t border-border/20">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Daily Spot Checks</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium">{completedCount}/{dayCount}</span>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const isToday = day.key === today;
          const isFuture = day.key > today;
          const isCompleted = completedDays.has(day.key);
          const isPast = day.key < today && !isCompleted;

          return (
            <button
              key={day.key}
              disabled={isFuture || isPast}
              onClick={() => {
                if (isCompleted) setPreviewDay(day.key);
                else if (isToday) console.log("Start daily count for", day.key);
              }}
              className={`
                flex flex-col items-center gap-1 py-2 rounded-xl transition-all relative
                ${isCompleted
                  ? "bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/15 cursor-pointer"
                  : isToday
                    ? "bg-primary/8 border-2 border-primary/50 hover:bg-primary/12 shadow-sm"
                    : isFuture
                      ? "bg-muted/20 border border-transparent opacity-35 cursor-not-allowed"
                      : isPast
                        ? "bg-muted/30 border border-border/20 opacity-50 cursor-not-allowed"
                        : "bg-muted/30 border border-transparent"
                }
              `}
            >
              <span className={`text-[10px] font-bold leading-none tracking-wide ${
                isToday ? "text-primary" : isCompleted ? "text-emerald-700" : "text-muted-foreground"
              }`}>
                {day.label}
              </span>
              <div className="h-5 w-5 flex items-center justify-center">
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : isToday ? (
                  <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                    <Play className="h-2.5 w-2.5 text-primary-foreground ml-[1px]" />
                  </div>
                ) : (
                  <div className={`h-1.5 w-1.5 rounded-full ${isFuture ? "bg-muted-foreground/20" : "bg-muted-foreground/30"}`} />
                )}
              </div>
              {isToday && !isCompleted && (
                <span className="text-[7px] font-bold text-primary uppercase leading-none tracking-wider">Count</span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[9px] text-muted-foreground/60 mt-1.5 text-center italic">
        Daily counts are locked until end of business
      </p>

      {/* Daily Count Preview Dialog */}
      <Dialog open={!!previewDay} onOpenChange={(open) => !open && setPreviewDay(null)}>
        <DialogContent className="max-w-sm p-0 gap-0 rounded-2xl">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/20">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-bold">
                  {previewDay ? format(new Date(previewDay + "T12:00:00"), "EEEE, MMM d") : ""}
                </DialogTitle>
                <span className="text-[11px] text-muted-foreground">Sarah M. · 9:42 PM</span>
              </div>
              <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Done
              </Badge>
            </div>
          </DialogHeader>

          <div className="px-4 py-3 max-h-[50vh] overflow-y-auto">
            <div className="space-y-0.5">
              {MOCK_DAILY_ITEMS.map((item, i) => {
                const hasVariance = item.counted !== item.expected;
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between py-2 px-2.5 rounded-lg ${
                      hasVariance ? "bg-amber-500/5" : ""
                    }`}
                  >
                    <span className="text-sm font-medium">{item.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm font-bold tabular-nums ${
                        hasVariance ? "text-amber-600" : "text-foreground"
                      }`}>
                        {item.counted}
                      </span>
                      {hasVariance && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">/ {item.expected}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{item.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 pt-3 border-t border-border/20 flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">
                {MOCK_DAILY_ITEMS.length} items counted
              </span>
              <span className="text-xs font-semibold text-amber-600">
                {MOCK_DAILY_ITEMS.filter((i) => i.counted !== i.expected).length} variances
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ——— Small components ———
function StatusBadge({ status, isUpcoming }: { status: string; isUpcoming: boolean }) {
  if (isUpcoming) return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
      Current
    </Badge>
  );
  if (status === "in_progress") return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-amber-500/40 text-amber-600 bg-amber-500/5">
      In Progress
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

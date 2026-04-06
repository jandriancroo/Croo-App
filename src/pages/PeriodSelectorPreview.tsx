import { useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronLeft, ChevronRight, Calendar, TrendingDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Mock period data
const MOCK_PERIODS = [
  { id: "1", type: "weekly", endDate: "2026-04-12", status: "upcoming", cogs: null },
  { id: "2", type: "weekly", endDate: "2026-04-05", status: "completed", cogs: 19.4 },
  { id: "3", type: "monthly", endDate: "2026-03-26", status: "completed", cogs: 21.2 },
  { id: "4", type: "weekly", endDate: "2026-03-29", status: "completed", cogs: 18.7 },
  { id: "5", type: "weekly", endDate: "2026-03-22", status: "completed", cogs: 20.1 },
  { id: "6", type: "weekly", endDate: "2026-03-15", status: "completed", cogs: 22.5 },
  { id: "7", type: "weekly", endDate: "2026-03-09", status: "in_progress", cogs: null },
  { id: "8", type: "weekly", endDate: "2026-03-08", status: "completed", cogs: 19.8 },
  { id: "9", type: "weekly", endDate: "2026-03-02", status: "completed", cogs: 21.0 },
  { id: "10", type: "weekly", endDate: "2026-02-23", status: "completed", cogs: 20.3 },
];

function formatLabel(p: typeof MOCK_PERIODS[0]) {
  const d = new Date(p.endDate + "T12:00:00");
  return p.type === "monthly" ? format(d, "MMM ''yy") : format(d, "MMM d");
}

function DetailCard({ period }: { period: typeof MOCK_PERIODS[0] }) {
  const d = new Date(period.endDate + "T12:00:00");
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          {period.type === "monthly" ? "Month" : "Week"} Ending {format(d, "MMM d, yyyy")}
        </h3>
        {period.cogs != null && (
          <span className={cn("text-lg font-bold", period.cogs <= 20 ? "text-emerald-600" : "text-amber-600")}>
            {period.cogs}% <span className="text-xs font-normal text-muted-foreground">COGS</span>
          </span>
        )}
      </div>
      <div className="h-16 bg-muted/30 rounded-lg flex items-center justify-center text-xs text-muted-foreground">
        Period detail content area
      </div>
    </div>
  );
}

// ─── Concept 1: Tabbed Underline ────────────────────────────────────
function Concept1({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex overflow-x-auto border-b border-border" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActive(i)}
            className={cn(
              "relative px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0",
              active === i ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="text-[9px] uppercase block tracking-wider opacity-60">
              {p.type === "monthly" ? "Mo" : "Wk"}
            </span>
            <span className="font-semibold">{formatLabel(p)}</span>
            {p.status === "completed" && active !== i && (
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500/50 inline ml-1" />
            )}
            {active === i && (
              <motion.div
                layoutId="tab-underline-1"
                className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary rounded-t-full"
              />
            )}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <DetailCard period={MOCK_PERIODS[active]} />
      </div>
    </div>
  );
}

// ─── Concept 2: Segmented Cards (expanding active) ──────────────────
function Concept2({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <motion.button
              key={p.id}
              onClick={() => setActive(i)}
              animate={{ width: isActive ? 120 : isMonthly ? 72 : 80 }}
              className={cn(
                "flex-shrink-0 rounded-t-xl border border-b-0 transition-all",
                isActive
                  ? "bg-primary text-primary-foreground border-primary shadow-lg pt-3 pb-2"
                  : isMonthly
                  ? "bg-muted/60 text-muted-foreground border-border/40 py-2"
                  : "bg-card text-foreground border-border/40 hover:bg-muted/40 py-2"
              )}
            >
              <div className="flex flex-col items-center gap-0.5">
                <span className={cn("text-[9px] uppercase font-bold tracking-wider", isActive ? "text-primary-foreground/60" : "text-muted-foreground/60")}>
                  {isMonthly ? "Mo" : "Wk"} Ending
                </span>
                <span className={cn("text-sm font-bold", !isActive && p.status === "completed" && "text-muted-foreground")}>
                  {formatLabel(p)}
                </span>
                {isActive && p.cogs != null && (
                  <span className="text-[11px] font-semibold text-primary-foreground/70">{p.cogs}%</span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
      <DetailCard period={MOCK_PERIODS[active]} />
    </div>
  );
}

// ─── Concept 3: Timeline Rail ───────────────────────────────────────
function Concept3({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="relative overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
        {/* Rail line */}
        <div className="absolute top-[18px] left-0 right-0 h-[2px] bg-border" />
        <div className="flex gap-6 px-4 relative">
          {MOCK_PERIODS.map((p, i) => {
            const isActive = active === i;
            const isMonthly = p.type === "monthly";
            return (
              <button
                key={p.id}
                onClick={() => setActive(i)}
                className="flex flex-col items-center flex-shrink-0 relative"
              >
                {/* Node */}
                <div className={cn(
                  "w-9 h-9 rounded-full border-[3px] flex items-center justify-center transition-all z-10",
                  isActive
                    ? "bg-primary border-primary text-primary-foreground scale-110 shadow-lg"
                    : isMonthly
                    ? "bg-card border-primary/40 text-primary"
                    : p.status === "completed"
                    ? "bg-muted border-emerald-400/50"
                    : "bg-card border-border"
                )}>
                  {isMonthly ? (
                    <Calendar className="h-3.5 w-3.5" />
                  ) : p.status === "completed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-current" />
                  )}
                </div>
                {/* Label */}
                <span className={cn(
                  "text-[10px] font-semibold mt-1 whitespace-nowrap",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}>
                  {formatLabel(p)}
                </span>
                {/* COGS under active */}
                {isActive && p.cogs != null && (
                  <span className="text-[10px] font-bold text-primary">{p.cogs}%</span>
                )}
                {/* Bridge line to detail */}
                {isActive && (
                  <div className="w-[2px] h-3 bg-primary mt-1" />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <DetailCard period={MOCK_PERIODS[active]} />
    </div>
  );
}

// ─── Concept 4: Stacked Accordion ───────────────────────────────────
function Concept4({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div className="space-y-1 max-h-[420px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      {MOCK_PERIODS.map((p, i) => {
        const isActive = active === i;
        const isMonthly = p.type === "monthly";
        const d = new Date(p.endDate + "T12:00:00");
        return (
          <div key={p.id}>
            <button
              onClick={() => setActive(i)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-card hover:bg-muted/40 border border-border/40",
                isMonthly && !isActive && "border-l-4 border-l-primary/30"
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn("text-[10px] uppercase font-bold tracking-wider w-8",
                  isActive ? "text-primary-foreground/60" : "text-muted-foreground"
                )}>
                  {isMonthly ? "MO" : "WK"}
                </span>
                <span className="font-semibold text-sm">
                  {isMonthly ? "Month" : "Week"} Ending {format(d, "MMM d")}
                </span>
                {p.status === "completed" && !isActive && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/50" />
                )}
              </div>
              {p.cogs != null && (
                <span className={cn("text-sm font-bold",
                  isActive ? "text-primary-foreground/80" : p.cogs <= 20 ? "text-emerald-600" : "text-amber-600"
                )}>
                  {p.cogs}%
                </span>
              )}
            </button>
            <AnimatePresence>
              {isActive && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pt-2 pb-1">
                    <div className="bg-muted/20 border border-border/30 rounded-xl p-4">
                      <div className="h-16 flex items-center justify-center text-xs text-muted-foreground">
                        Period detail content area
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ─── Concept 5: Pill + Tab Bridge ───────────────────────────────────
function Concept5({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-0" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <div key={p.id} className="flex flex-col items-center flex-shrink-0">
              <button
                onClick={() => setActive(i)}
                className={cn(
                  "px-3 py-2 rounded-t-xl text-sm font-semibold transition-all whitespace-nowrap",
                  isActive
                    ? "bg-card text-foreground border border-b-0 border-border shadow-sm"
                    : "bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted/80",
                  isMonthly && "font-bold"
                )}
              >
                <span className="text-[9px] uppercase block tracking-wider opacity-50 font-bold">
                  {isMonthly ? "Mo" : "Wk"}
                </span>
                {formatLabel(p)}
              </button>
              {isActive && <div className="w-full h-[2px] bg-card" />}
            </div>
          );
        })}
      </div>
      <DetailCard period={MOCK_PERIODS[active]} />
    </div>
  );
}

// ─── Concept 6: Vertical Timeline ───────────────────────────────────
function Concept6({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div className="flex gap-4 max-h-[420px]">
      {/* Left sidebar timeline */}
      <div className="w-32 flex-shrink-0 overflow-y-auto space-y-0 relative" style={{ scrollbarWidth: "thin" }}>
        <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-border" />
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <button
              key={p.id}
              onClick={() => setActive(i)}
              className={cn(
                "w-full flex items-center gap-2 py-2 px-1 text-left relative z-10 transition-all",
                isActive ? "scale-105" : ""
              )}
            >
              <div className={cn(
                "w-[10px] h-[10px] rounded-full flex-shrink-0 transition-all border-2",
                isActive ? "bg-primary border-primary scale-150" : isMonthly ? "bg-primary/30 border-primary/50" : "bg-muted border-border"
              )} />
              <div className="flex flex-col">
                <span className={cn(
                  "text-[9px] uppercase font-bold leading-none",
                  isActive ? "text-primary" : "text-muted-foreground/60"
                )}>
                  {isMonthly ? "Mo" : "Wk"}
                </span>
                <span className={cn(
                  "text-xs font-semibold leading-tight",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}>
                  {formatLabel(p)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {/* Right detail */}
      <div className="flex-1 min-w-0">
        <DetailCard period={MOCK_PERIODS[active]} />
      </div>
    </div>
  );
}

// ─── Concept 7: Floating Cards (staggered) ──────────────────────────
function Concept7({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-4" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <motion.button
              key={p.id}
              onClick={() => setActive(i)}
              animate={{ y: isActive ? 0 : isMonthly ? -4 : 8 }}
              className={cn(
                "flex-shrink-0 rounded-2xl transition-all px-3 py-3 min-w-[80px]",
                isActive
                  ? "bg-primary text-primary-foreground shadow-xl shadow-primary/20 scale-105"
                  : isMonthly
                  ? "bg-gradient-to-b from-primary/10 to-primary/5 border border-primary/20 text-foreground"
                  : "bg-card border border-border/40 hover:border-border text-foreground"
              )}
            >
              <div className="flex flex-col items-center gap-0.5">
                <span className={cn("text-[9px] uppercase font-bold tracking-wider",
                  isActive ? "text-primary-foreground/60" : "text-muted-foreground/60"
                )}>
                  {isMonthly ? "Mo" : "Wk"}
                </span>
                <span className="text-sm font-bold">{formatLabel(p)}</span>
                {p.cogs != null && (
                  <span className={cn("text-[10px] font-semibold",
                    isActive ? "text-primary-foreground/70" : p.cogs <= 20 ? "text-emerald-600/70" : "text-amber-600/70"
                  )}>
                    {p.cogs}%
                  </span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
      <DetailCard period={MOCK_PERIODS[active]} />
    </div>
  );
}

// ─── Concept 8: Chip Row with COGS Badge ────────────────────────────
function Concept8({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <button
              key={p.id}
              onClick={() => setActive(i)}
              className={cn(
                "flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-2 transition-all",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted",
                isMonthly && !isActive && "ring-1 ring-primary/20"
              )}
            >
              <span className="text-xs font-semibold whitespace-nowrap">
                {isMonthly ? "📅 " : ""}{formatLabel(p)}
              </span>
              {p.cogs != null && (
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  isActive
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : p.cogs <= 20 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                )}>
                  {p.cogs}%
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <DetailCard period={MOCK_PERIODS[active]} />
      </div>
    </div>
  );
}

// ─── Concept 9: Split View (Monthly = sections) ────────────────────
function Concept9({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  // Group by month
  const months = MOCK_PERIODS.reduce((acc, p, i) => {
    const d = new Date(p.endDate + "T12:00:00");
    const monthKey = format(d, "MMMM yyyy");
    if (!acc.has(monthKey)) acc.set(monthKey, []);
    acc.get(monthKey)!.push({ ...p, idx: i });
    return acc;
  }, new Map<string, (typeof MOCK_PERIODS[0] & { idx: number })[]>());

  return (
    <div>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
        {[...months.entries()].map(([month, periods]) => (
          <div key={month} className="flex-shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1 px-1">
              {month}
            </div>
            <div className="flex gap-1">
              {periods.map((p) => {
                const isActive = active === p.idx;
                const isMonthly = p.type === "monthly";
                return (
                  <button
                    key={p.id}
                    onClick={() => setActive(p.idx)}
                    className={cn(
                      "px-2.5 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-md"
                        : isMonthly
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "bg-card border border-border/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isMonthly ? "ME" : formatLabel(p)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <DetailCard period={MOCK_PERIODS[active]} />
      </div>
    </div>
  );
}

// ─── Concept 10: Notch Cards (current but refined) ──────────────────
function Concept10({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <div key={p.id} className="flex flex-col items-center flex-shrink-0"
              style={{ minWidth: isMonthly ? 78 : 88 }}>
              <button
                onClick={() => setActive(i)}
                className={cn(
                  "w-full rounded-xl border transition-all duration-200 relative",
                  isMonthly ? "py-2.5 h-[68px]" : "py-1.5 h-[54px]",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : isMonthly
                    ? p.status === "completed"
                      ? "bg-muted/80 text-muted-foreground border-border/50 shadow-sm"
                      : "bg-card text-foreground border-border/60 hover:bg-muted/40 shadow-sm"
                    : p.status === "completed"
                    ? "bg-muted/60 text-muted-foreground border-border/30"
                    : "bg-card text-foreground border-border/40 hover:bg-muted/40"
                )}
              >
                <div className="flex flex-col items-center gap-0 justify-center h-full">
                  <span className={cn("text-[9px] uppercase font-bold tracking-wider leading-none",
                    isActive ? "text-primary-foreground/60" : "text-muted-foreground/60"
                  )}>
                    {isMonthly ? "Mo" : "Wk"} Ending
                  </span>
                  <span className={cn("text-sm font-bold leading-tight whitespace-nowrap flex items-center gap-0.5",
                    !isActive && p.status === "completed" && "text-muted-foreground"
                  )}>
                    {formatLabel(p)}
                    {p.status === "completed" && !isActive && (
                      <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500/50" />
                    )}
                  </span>
                  {p.cogs != null && (
                    <span className={cn("text-[10px] tabular-nums font-semibold leading-none",
                      isActive ? "text-primary-foreground/70" : p.cogs <= 20 ? "text-emerald-600/70" : "text-amber-600/70"
                    )}>
                      {p.cogs}%
                    </span>
                  )}
                </div>
              </button>
              {isActive ? (
                <div className="w-0 h-0 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-primary -mb-px relative z-10" />
              ) : (
                <div className="h-[7px]" />
              )}
            </div>
          );
        })}
      </div>
      <DetailCard period={MOCK_PERIODS[active]} />
    </div>
  );
}

// ─── Main Preview Page ──────────────────────────────────────────────
export default function PeriodSelectorPreview() {
  const [actives, setActives] = useState<number[]>(Array(10).fill(1));

  const setActiveFor = (concept: number) => (idx: number) =>
    setActives((prev) => { const next = [...prev]; next[concept] = idx; return next; });

  const concepts = [
    { name: "1 · Tabbed Underline", Component: Concept1 },
    { name: "2 · Segmented Cards", Component: Concept2 },
    { name: "3 · Timeline Rail", Component: Concept3 },
    { name: "4 · Stacked Accordion", Component: Concept4 },
    { name: "5 · Pill + Tab Bridge", Component: Concept5 },
    { name: "6 · Vertical Timeline", Component: Concept6 },
    { name: "7 · Floating Stagger", Component: Concept7 },
    { name: "8 · Chip Row + COGS Badge", Component: Concept8 },
    { name: "9 · Month-Grouped Sections", Component: Concept9 },
    { name: "10 · Notch Cards (current refined)", Component: Concept10 },
  ];

  return (
    <div className="min-h-screen bg-background p-4 space-y-8 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Period Selector Concepts</h1>
        <p className="text-sm text-muted-foreground mt-1">10 design options — tap each to interact</p>
      </div>

      {concepts.map((c, ci) => (
        <div key={ci} className="space-y-2">
          <h2 className="text-sm font-bold text-primary uppercase tracking-wider">{c.name}</h2>
          <div className="bg-muted/20 rounded-2xl border border-border/40 p-3">
            <c.Component active={actives[ci]} setActive={setActiveFor(ci)} />
          </div>
        </div>
      ))}
    </div>
  );
}

import { useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

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
    <div className="bg-card border border-border border-t-0 rounded-b-xl p-4 space-y-2">
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

// ─── B: Pill Tab Bridge (your pick) ─────────────────────────────────
// All tabs sit as a continuous row, active one bridges directly into card
function ConceptB({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <button
              key={p.id}
              onClick={() => setActive(i)}
              className={cn(
                "flex-shrink-0 px-3 py-2 text-sm font-semibold transition-all whitespace-nowrap border-b-2",
                isActive
                  ? "bg-card text-foreground border-x border-t border-b-0 border-border rounded-t-xl -mb-[1px] z-10"
                  : "bg-transparent text-muted-foreground border-b-transparent hover:bg-muted/30 hover:text-foreground",
                isMonthly && "font-bold"
              )}
            >
              <span className="text-[9px] uppercase block tracking-wider opacity-50 font-bold">
                {isMonthly ? "Mo" : "Wk"}
              </span>
              {formatLabel(p)}
            </button>
          );
        })}
      </div>
      <DetailCard period={MOCK_PERIODS[active]} />
    </div>
  );
}

// ─── D: Raised Active + Primary Bridge (your pick) ──────────────────
function ConceptD({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto items-end" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <motion.div
              key={p.id}
              className="flex-shrink-0 flex flex-col items-center"
              animate={{ marginBottom: isActive ? 0 : 4 }}
            >
              <motion.button
                onClick={() => setActive(i)}
                animate={{ height: isActive ? 72 : isMonthly ? 62 : 52 }}
                className={cn(
                  "transition-all rounded-t-2xl flex items-center justify-center",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 w-[110px] border-2 border-b-0 border-primary"
                    : isMonthly
                    ? "bg-muted/60 text-muted-foreground w-[74px] border border-b-0 border-border/40"
                    : "bg-card text-muted-foreground w-[82px] border border-b-0 border-border/30 hover:bg-muted/30"
                )}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <span className={cn("text-[9px] uppercase font-bold tracking-wider",
                    isActive ? "text-primary-foreground/60" : "text-muted-foreground/50"
                  )}>
                    {isMonthly ? "Mo" : "Wk"} Ending
                  </span>
                  <span className={cn("text-sm font-bold",
                    isActive ? "text-primary-foreground" : p.status === "completed" ? "text-muted-foreground" : ""
                  )}>
                    {formatLabel(p)}
                    {p.status === "completed" && !isActive && (
                      <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500/40 inline ml-0.5" />
                    )}
                  </span>
                  {isActive && p.cogs != null && (
                    <span className="text-[11px] font-semibold text-primary-foreground/80">{p.cogs}%</span>
                  )}
                </div>
              </motion.button>
            </motion.div>
          );
        })}
      </div>
      <div className="border-t-[3px] border-t-primary">
        <DetailCard period={MOCK_PERIODS[active]} />
      </div>
    </div>
  );
}

// ─── E: Flush Tab Strip — D's elevated active + B's continuous tab row ──
// All tabs sit flush edge-to-edge like B, but the active tab is elevated
// with primary styling like D, and bridges directly into the card
function ConceptE({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-0 overflow-x-auto items-end" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <motion.button
              key={p.id}
              onClick={() => setActive(i)}
              animate={{ height: isActive ? 64 : isMonthly ? 54 : 46 }}
              className={cn(
                "flex-shrink-0 transition-all flex items-center justify-center",
                isActive
                  ? "bg-primary text-primary-foreground rounded-t-2xl min-w-[100px] px-3 shadow-md z-10 border-b-0"
                  : "bg-muted/30 text-muted-foreground rounded-t-lg min-w-[72px] px-2 hover:bg-muted/50 border-b border-border/20",
                isMonthly && !isActive && "min-w-[68px] bg-muted/50"
              )}
            >
              <div className="flex flex-col items-center gap-0">
                <span className={cn("text-[8px] uppercase font-bold tracking-widest",
                  isActive ? "text-primary-foreground/50" : "text-muted-foreground/40"
                )}>
                  {isMonthly ? "Mo" : "Wk"}
                </span>
                <span className={cn("text-xs font-bold whitespace-nowrap",
                  isActive && "text-sm"
                )}>
                  {formatLabel(p)}
                </span>
                {isActive && p.cogs != null && (
                  <span className="text-[10px] font-semibold text-primary-foreground/70">{p.cogs}%</span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
      <div className="border-t-[3px] border-t-primary">
        <DetailCard period={MOCK_PERIODS[active]} />
      </div>
    </div>
  );
}

// ─── F: Connected Cards — B's direct bridge + D's card sizing ───────
// Individual card-style tabs (with gaps) like D, but the active one uses
// B's approach of matching the card border exactly (no color fill, just
// border continuity)
function ConceptF({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto items-end" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <motion.button
              key={p.id}
              onClick={() => setActive(i)}
              animate={{
                height: isActive ? 68 : isMonthly ? 58 : 48,
                width: isActive ? 108 : isMonthly ? 72 : 80,
              }}
              className={cn(
                "flex-shrink-0 transition-all flex items-center justify-center rounded-t-xl",
                isActive
                  ? "bg-card text-foreground border border-border border-b-0 shadow-sm -mb-[1px] z-10"
                  : isMonthly
                  ? "bg-primary/8 text-muted-foreground border border-primary/15 border-b-0 rounded-t-xl"
                  : "bg-muted/30 text-muted-foreground border border-border/20 border-b-0 hover:bg-muted/50"
              )}
            >
              <div className="flex flex-col items-center gap-0.5">
                <span className={cn("text-[8px] uppercase font-bold tracking-widest",
                  isActive ? "text-primary" : "text-muted-foreground/40"
                )}>
                  {isMonthly ? "Mo" : "Wk"}
                </span>
                <span className={cn("text-sm font-bold whitespace-nowrap",
                  !isActive && p.status === "completed" && "text-muted-foreground/60"
                )}>
                  {formatLabel(p)}
                </span>
                {isActive && p.cogs != null && (
                  <span className={cn("text-[11px] font-bold",
                    p.cogs <= 20 ? "text-emerald-600" : "text-amber-600"
                  )}>
                    {p.cogs}%
                  </span>
                )}
                {!isActive && p.status === "completed" && (
                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500/30" />
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

// ─── G: Primary Tab Bar — B's flush layout + D's primary active ─────
// Continuous tab bar like B, but active tab gets D's primary background
// with a thick bottom-edge bridge that merges into the card's top border
function ConceptG({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-0 overflow-x-auto bg-muted/30 rounded-t-xl" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <button
              key={p.id}
              onClick={() => setActive(i)}
              className={cn(
                "flex-shrink-0 px-3 py-2.5 transition-all whitespace-nowrap relative",
                isActive
                  ? "bg-primary text-primary-foreground rounded-t-xl shadow-md z-10"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                isMonthly && !isActive && "bg-muted/20"
              )}
            >
              <div className="flex flex-col items-center gap-0">
                <span className={cn("text-[8px] uppercase font-bold tracking-widest",
                  isActive ? "text-primary-foreground/50" : "text-muted-foreground/40"
                )}>
                  {isMonthly ? "Mo" : "Wk"}
                </span>
                <span className={cn("text-xs font-bold",
                  isActive && "text-sm"
                )}>
                  {formatLabel(p)}
                </span>
                {isActive && p.cogs != null && (
                  <span className="text-[10px] font-semibold text-primary-foreground/70">{p.cogs}%</span>
                )}
              </div>
              {/* Subtle separator between inactive tabs */}
              {!isActive && i < MOCK_PERIODS.length - 1 && (
                <div className="absolute right-0 top-3 bottom-3 w-px bg-border/30" />
              )}
            </button>
          );
        })}
      </div>
      <DetailCard period={MOCK_PERIODS[active]} />
    </div>
  );
}

// ─── Main Preview Page ──────────────────────────────────────────────
export default function PeriodSelectorPreview() {
  const [actives, setActives] = useState<number[]>(Array(5).fill(1));

  const setActiveFor = (concept: number) => (idx: number) =>
    setActives((prev) => { const next = [...prev]; next[concept] = idx; return next; });

  const concepts = [
    { name: "B · Pill Tab Bridge", desc: "Your pick — clean direct bridge, all tabs visible", Component: ConceptB },
    { name: "D · Raised Active + Primary", desc: "Your pick — elevated primary active, bold presence", Component: ConceptD },
    { name: "E · Flush Strip + Elevated Active", desc: "B's continuous row + D's elevated primary active tab", Component: ConceptE },
    { name: "F · Connected Cards", desc: "D's card sizing + B's seamless border bridge (no fill, border continuity)", Component: ConceptF },
    { name: "G · Primary Tab Bar", desc: "B's flush tab bar + D's primary active, inside a muted container strip", Component: ConceptG },
  ];

  return (
    <div className="min-h-screen bg-background p-4 space-y-8 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Period Selector — Round 3</h1>
        <p className="text-sm text-muted-foreground mt-1">B + D hybrids — direct bridge + primary active</p>
      </div>

      {concepts.map((c, ci) => (
        <div key={ci} className="space-y-1">
          <h2 className="text-sm font-bold text-primary uppercase tracking-wider">{c.name}</h2>
          <p className="text-xs text-muted-foreground">{c.desc}</p>
          <div className="bg-muted/20 rounded-2xl border border-border/40 p-3">
            <c.Component active={actives[ci]} setActive={setActiveFor(ci)} />
          </div>
        </div>
      ))}
    </div>
  );
}

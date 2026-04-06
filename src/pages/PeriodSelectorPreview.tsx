import { useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { CheckCircle2, Calendar } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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

// ─── A: Segmented Cards (original #2) ───────────────────────────────
function ConceptA({ active, setActive }: { active: number; setActive: (n: number) => void }) {
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

// ─── B: Pill + Tab Bridge (original #5) ─────────────────────────────
function ConceptB({ active, setActive }: { active: number; setActive: (n: number) => void }) {
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

// ─── C: Expanding Bridge Cards ──────────────────────────────────────
// Concept 2 visual style + Concept 5 bridge: active card expands, has no bottom
// border, and seamlessly joins the detail card below
function ConceptC({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <motion.button
              key={p.id}
              onClick={() => setActive(i)}
              animate={{ flex: isActive ? "0 0 110px" : isMonthly ? "0 0 70px" : "0 0 80px" }}
              className={cn(
                "flex-shrink-0 border transition-all relative",
                isActive
                  ? "bg-card text-foreground border-border border-b-0 rounded-t-2xl pt-3 pb-3 shadow-sm z-10"
                  : isMonthly
                  ? "bg-muted/40 text-muted-foreground border-border/30 rounded-xl py-2 mb-[1px]"
                  : "bg-muted/20 text-muted-foreground border-border/20 rounded-xl py-2 hover:bg-muted/40 mb-[1px]"
              )}
            >
              {/* Active left/right accent */}
              {isActive && (
                <div className="absolute top-2 left-1.5 bottom-2 w-[3px] rounded-full bg-primary" />
              )}
              <div className="flex flex-col items-center gap-0.5">
                <span className={cn("text-[9px] uppercase font-bold tracking-wider",
                  isActive ? "text-primary" : "text-muted-foreground/50"
                )}>
                  {isMonthly ? "Mo" : "Wk"} Ending
                </span>
                <span className={cn("text-sm font-bold", !isActive && p.status === "completed" && "text-muted-foreground/70")}>
                  {formatLabel(p)}
                </span>
                {p.status === "completed" && !isActive && (
                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500/40" />
                )}
                {isActive && p.cogs != null && (
                  <span className={cn("text-[11px] font-bold", p.cogs <= 20 ? "text-emerald-600" : "text-amber-600")}>
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

// ─── D: Raised Active Card with Flush Bridge ────────────────────────
// Active card is elevated/larger with primary bg, bridges flush into
// the detail card with matching primary top border
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
      {/* Detail card with primary top accent matching active tab */}
      <div className="border-t-[3px] border-t-primary">
        <DetailCard period={MOCK_PERIODS[active]} />
      </div>
    </div>
  );
}

// ─── E: Glass Morph Cards with Connected Tab ────────────────────────
// Frosted glass inactive cards, active card bridges into detail with
// a subtle gradient connection
function ConceptE({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <motion.button
              key={p.id}
              onClick={() => setActive(i)}
              animate={{
                scale: isActive ? 1.05 : 1,
                y: isActive ? -2 : 0,
              }}
              className={cn(
                "flex-shrink-0 transition-all relative overflow-hidden",
                isActive
                  ? "rounded-t-2xl border border-b-0 border-border bg-card text-foreground shadow-md min-w-[105px] py-3"
                  : isMonthly
                  ? "rounded-xl border border-border/20 bg-muted/30 backdrop-blur-sm text-muted-foreground min-w-[68px] py-2 mb-[1px]"
                  : "rounded-xl border border-border/10 bg-muted/15 backdrop-blur-sm text-muted-foreground min-w-[78px] py-2 hover:bg-muted/30 mb-[1px]"
              )}
            >
              {/* Gradient overlay for active */}
              {isActive && (
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
              )}
              <div className="flex flex-col items-center gap-0.5 px-2">
                <span className={cn("text-[9px] uppercase font-bold tracking-wider",
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
                  <span className={cn("text-[11px] font-bold", p.cogs <= 20 ? "text-emerald-600" : "text-amber-600")}>
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

// ─── F: Compact Strip with Pop-Up Active ────────────────────────────
// Minimal compact strip, active card pops up and connects via a
// notch-bridge into the detail panel
function ConceptF({ active, setActive }: { active: number; setActive: (n: number) => void }) {
  return (
    <div>
      <div className="flex gap-0.5 overflow-x-auto items-end" style={{ scrollbarWidth: "none" }}>
        {MOCK_PERIODS.map((p, i) => {
          const isActive = active === i;
          const isMonthly = p.type === "monthly";
          return (
            <div key={p.id} className="flex flex-col items-center flex-shrink-0">
              <motion.button
                onClick={() => setActive(i)}
                animate={{
                  height: isActive ? 68 : isMonthly ? 56 : 46,
                  width: isActive ? 100 : isMonthly ? 68 : 76,
                }}
                className={cn(
                  "transition-all flex items-center justify-center",
                  isActive
                    ? "bg-primary text-primary-foreground rounded-t-2xl shadow-lg"
                    : isMonthly
                    ? "bg-muted/50 text-muted-foreground rounded-t-xl border border-b-0 border-border/30"
                    : "bg-transparent text-muted-foreground rounded-t-lg hover:bg-muted/30"
                )}
              >
                <div className="flex flex-col items-center gap-0">
                  <span className={cn("text-[8px] uppercase font-bold tracking-widest",
                    isActive ? "text-primary-foreground/50" : "text-muted-foreground/40"
                  )}>
                    {isMonthly ? "Mo" : "Wk"}
                  </span>
                  <span className={cn("font-bold whitespace-nowrap",
                    isActive ? "text-sm" : "text-xs",
                    !isActive && p.status === "completed" && "text-muted-foreground/60"
                  )}>
                    {formatLabel(p)}
                  </span>
                  {isActive && p.cogs != null && (
                    <span className="text-[10px] font-semibold text-primary-foreground/70">{p.cogs}%</span>
                  )}
                </div>
              </motion.button>
              {/* Bridge connector — fills the gap between tab and detail card */}
              {isActive ? (
                <div className="w-full h-[3px] bg-primary" />
              ) : (
                <div className="h-[3px]" />
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
  const [actives, setActives] = useState<number[]>(Array(6).fill(1));

  const setActiveFor = (concept: number) => (idx: number) =>
    setActives((prev) => { const next = [...prev]; next[concept] = idx; return next; });

  const concepts = [
    { name: "A · Segmented Cards (your pick)", desc: "Expanding active card, visual weight", Component: ConceptA },
    { name: "B · Pill Tab Bridge (your pick)", desc: "Clean bridge connection to detail", Component: ConceptB },
    { name: "C · Expanding Bridge Cards", desc: "A's expanding cards + B's seamless bridge, accent bar", Component: ConceptC },
    { name: "D · Raised Active + Primary Bridge", desc: "Active card elevated with primary color, flush top border", Component: ConceptD },
    { name: "E · Glass Morph + Gradient Bridge", desc: "Frosted inactive, gradient top accent on active bridge", Component: ConceptE },
    { name: "F · Compact Strip + Pop-Up Bridge", desc: "Minimal strip, active pops up tall with primary bridge bar", Component: ConceptF },
  ];

  return (
    <div className="min-h-screen bg-background p-4 space-y-8 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Period Selector — Round 2</h1>
        <p className="text-sm text-muted-foreground mt-1">Combining Concept 2 visuals + Concept 5 bridge</p>
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

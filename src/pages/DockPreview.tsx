import { useState } from "react";
import { Home, ClipboardList, Package, MessageSquare, Mic, ChevronUp, ChevronLeft } from "lucide-react";
import { TheoOrb } from "@/components/dock/TheoOrb";
import { cn } from "@/lib/utils";

type State = "dashboard" | "inventory" | "swiped";

const TABS = [
  { icon: Home, label: "Home" },
  { icon: ClipboardList, label: "Tasks" },
  { icon: Package, label: "Inventory" },
  { icon: MessageSquare, label: "Messages" },
];

function PillDock({ active, dim = false }: { active: number; dim?: boolean }) {
  return (
    <div className="mx-auto w-[92%]">
      <div
        className={cn(
          "h-[60px] rounded-full px-3 flex items-center justify-between",
          "bg-black/60 backdrop-blur-2xl border border-white/10",
          "shadow-[0_8px_32px_rgba(0,0,0,0.5)]",
          dim && "opacity-70"
        )}
      >
        {TABS.map((T, i) => (
          <button
            key={T.label}
            className={cn(
              "w-10 h-10 flex items-center justify-center rounded-full transition-colors",
              i === active ? "text-white" : "text-white/40"
            )}
          >
            <T.icon className="w-[22px] h-[22px]" strokeWidth={i === active ? 2.5 : 2} />
          </button>
        ))}
        <TheoOrb size={40} className="text-white" />
      </div>
    </div>
  );
}

function PhoneFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <div
        className="relative bg-neutral-950 rounded-[44px] border-[6px] border-neutral-800 shadow-2xl overflow-hidden"
        style={{ width: 320, height: 660 }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- STATE 1: Dashboard ---------- */
function DashboardState() {
  return (
    <div className="absolute inset-0 bg-neutral-950 text-white flex flex-col">
      <div className="p-5 pt-10 space-y-5 flex-1 overflow-hidden">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-xs text-white/40">Palm Springs</div>
            <h1 className="text-xl font-bold">Dashboard</h1>
          </div>
          <div className="w-9 h-9 rounded-full bg-neutral-800" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 rounded-2xl bg-gradient-to-br from-emerald-900/40 to-neutral-900 border border-white/5 p-3">
            <div className="text-[10px] text-white/40 uppercase">Sales</div>
            <div className="text-lg font-bold">$12,480</div>
            <div className="text-[10px] text-emerald-400">+4.2% YoY</div>
          </div>
          <div className="h-24 rounded-2xl bg-gradient-to-br from-blue-900/40 to-neutral-900 border border-white/5 p-3">
            <div className="text-[10px] text-white/40 uppercase">Labor</div>
            <div className="text-lg font-bold">28.4%</div>
            <div className="text-[10px] text-blue-400">on target</div>
          </div>
        </div>
        <div className="h-32 rounded-2xl bg-neutral-900/60 border border-white/5" />
        <div className="h-24 rounded-2xl bg-neutral-900/60 border border-white/5" />
      </div>
      <div className="pb-6">
        <PillDock active={0} />
      </div>
    </div>
  );
}

/* ---------- STATE 2: Inventory Count (morphed dock) ---------- */
function InventoryState() {
  return (
    <div className="absolute inset-0 bg-neutral-950 text-white flex flex-col">
      <div className="p-5 pt-10 flex-1 overflow-hidden">
        <div className="flex items-center gap-2 mb-4">
          <ChevronLeft className="w-5 h-5 text-white/60" />
          <h1 className="text-base font-semibold">Bar — Walk-in</h1>
        </div>
        <div className="space-y-2">
          {["Tito's Vodka 1L", "Jameson 750ml", "Casamigos Blanco", "Hendricks Gin", "Patron Silver"].map((n, i) => (
            <div
              key={n}
              className={cn(
                "h-14 rounded-xl border flex items-center justify-between px-3",
                i === 1
                  ? "bg-blue-500/10 border-blue-500/40"
                  : "bg-neutral-900/60 border-white/5"
              )}
            >
              <span className="text-sm">{n}</span>
              <span className={cn("text-sm font-mono", i === 1 ? "text-blue-300" : "text-white/40")}>
                {i === 1 ? "--" : (Math.random() * 5).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Morphed smart dock */}
      <div className="pb-6">
        <div className="mx-auto w-[94%]">
          <div className="bg-black/75 backdrop-blur-2xl border border-white/15 rounded-[28px] p-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.6)] space-y-3">
            {/* Data row */}
            <div className="flex items-center justify-between px-1">
              <div>
                <div className="text-[9px] text-white/40 uppercase tracking-wider">Total Value</div>
                <div className="text-lg font-bold leading-tight">$4,285.50</div>
              </div>
              <div className="text-center">
                <div className="text-[9px] text-white/40 uppercase tracking-wider">Counted</div>
                <div className="text-sm font-semibold">
                  45 <span className="text-white/40 font-normal">/ 120</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-white/40 uppercase tracking-wider">Timer</div>
                <div className="text-sm font-mono text-emerald-400">08:42</div>
              </div>
            </div>
            {/* Controls */}
            <div className="flex items-center gap-2">
              <button className="h-11 w-11 rounded-full bg-neutral-800 border border-white/10 flex items-center justify-center text-white/70 shrink-0">
                <Mic className="w-5 h-5" />
              </button>
              <button className="flex-1 h-11 bg-white text-black text-sm font-semibold rounded-full">
                Save Count
              </button>
              <TheoOrb size={44} className="text-white shrink-0" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- STATE 3: Swiped-up (Theo / Manager sheet) ---------- */
function SwipedState() {
  return (
    <div className="absolute inset-0 bg-neutral-950 text-white flex flex-col">
      {/* dim background */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Sheet */}
      <div className="absolute bottom-0 inset-x-0 top-[14%] bg-neutral-900 rounded-t-[36px] border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.7)] flex flex-col">
        <div className="w-10 h-1.5 bg-white/15 rounded-full mx-auto mt-3 mb-4" />
        <div className="px-5 flex-1 overflow-hidden">
          <div className="flex items-center gap-3 mb-5">
            <TheoOrb size={44} className="text-white" />
            <div>
              <h2 className="text-base font-bold">Theo Insights</h2>
              <p className="text-xs text-white/50">Manager Dashboard</p>
            </div>
          </div>
          <div className="space-y-2.5">
            <div className="p-3.5 bg-white/5 rounded-2xl border border-white/5">
              <div className="text-[10px] text-amber-400 font-semibold uppercase mb-1">Labor Alert</div>
              <p className="text-xs text-white/80 leading-relaxed">
                Weekly labor is up 4.2% vs last month. Consider cutting one server early.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 bg-white/5 rounded-2xl border border-white/5">
                <div className="text-[10px] text-white/40 uppercase">COGS</div>
                <div className="text-base font-semibold">28.4%</div>
              </div>
              <div className="p-3 bg-white/5 rounded-2xl border border-white/5">
                <div className="text-[10px] text-white/40 uppercase">Revenue</div>
                <div className="text-base font-semibold">$42.1k</div>
              </div>
            </div>
            <div className="p-3.5 bg-white/5 rounded-2xl border border-white/5">
              <div className="text-[10px] text-emerald-400 font-semibold uppercase mb-1">Stock</div>
              <p className="text-xs text-white/80 leading-relaxed">
                Cold brew concentrate runs out by Friday at current velocity.
              </p>
            </div>
          </div>
        </div>

        {/* Dock pinned to sheet bottom */}
        <div className="pb-5">
          <PillDock active={0} dim />
        </div>
      </div>
    </div>
  );
}

export default function DockPreview() {
  const [state, setState] = useState<State>("dashboard");

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Instagram-Style Dock — Preview</h1>
            <p className="text-sm text-muted-foreground">
              Floating pill dock across Dashboard, Inventory Count, and Swiped-Up Manager states.
            </p>
          </div>
          <div className="inline-flex rounded-full bg-muted p-1 text-xs font-medium">
            {(["dashboard", "inventory", "swiped"] as State[]).map((s) => (
              <button
                key={s}
                onClick={() => setState(s)}
                className={cn(
                  "px-4 py-2 rounded-full capitalize transition-colors",
                  state === s ? "bg-background shadow-sm" : "text-muted-foreground"
                )}
              >
                {s === "swiped" ? "Swiped Up" : s}
              </button>
            ))}
          </div>
        </header>

        {/* Triptych: all three side-by-side */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            All three states
          </h2>
          <div className="flex flex-wrap gap-8 justify-center bg-neutral-900/30 rounded-3xl p-8 border border-border/40">
            <PhoneFrame label="Dashboard">
              <DashboardState />
            </PhoneFrame>
            <PhoneFrame label="Inventory Count">
              <InventoryState />
            </PhoneFrame>
            <PhoneFrame label="Swiped Up">
              <SwipedState />
            </PhoneFrame>
          </div>
        </section>

        {/* Focused single view */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Focused: {state}
          </h2>
          <div className="flex justify-center bg-neutral-900/30 rounded-3xl p-8 border border-border/40">
            <div
              className="relative bg-neutral-950 rounded-[52px] border-[8px] border-neutral-800 shadow-2xl overflow-hidden"
              style={{ width: 390, height: 800 }}
            >
              {state === "dashboard" && <DashboardState />}
              {state === "inventory" && <InventoryState />}
              {state === "swiped" && <SwipedState />}
              {state === "dashboard" && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-white/40 text-[10px] animate-bounce pointer-events-none">
                  <ChevronUp className="w-3 h-3" /> swipe up for Theo
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

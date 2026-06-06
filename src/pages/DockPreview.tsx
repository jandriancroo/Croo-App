import { useState } from "react";
import { Home, ClipboardList, Package, MessageSquare, Mic } from "lucide-react";
import { TheoOrb } from "@/components/dock/TheoOrb";
import { cn } from "@/lib/utils";

type State = "dashboard" | "inventory" | "swiped";
type Style = "frosted" | "solid" | "glow";

const TABS = [
  { icon: Home, label: "Home" },
  { icon: ClipboardList, label: "Tasks" },
  { icon: Package, label: "Inventory" },
  { icon: MessageSquare, label: "Messages" },
];

/* ============================================================
   THREE DISTINCT STYLE TOKENS
   ============================================================ */
const STYLES: Record<Style, {
  name: string;
  blurb: string;
  dock: string;          // pill wrapper classes
  iconActive: string;
  iconIdle: string;
  smartDock: string;     // morphed inventory dock wrapper
  saveBtn: string;
  micBtn: string;
  accent: string;        // for counted numbers etc
}> = {
  frosted: {
    name: "A · Frosted Glass",
    blurb: "Translucent dark pill, heavy blur, hairline white border. Closest to Instagram.",
    dock: "bg-black/55 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.45)]",
    iconActive: "text-white",
    iconIdle: "text-white/45",
    smartDock: "bg-black/65 backdrop-blur-2xl border border-white/12 shadow-[0_10px_40px_rgba(0,0,0,0.5)]",
    saveBtn: "bg-white text-black",
    micBtn: "bg-white/10 border border-white/15 text-white/80",
    accent: "text-emerald-400",
  },
  solid: {
    name: "B · Solid Charcoal",
    blurb: "Opaque charcoal pill, no blur, soft outer shadow. Crisper, more 'app-like'.",
    dock: "bg-neutral-900 border border-neutral-800 shadow-[0_12px_30px_rgba(0,0,0,0.55)]",
    iconActive: "text-white",
    iconIdle: "text-neutral-500",
    smartDock: "bg-neutral-900 border border-neutral-800 shadow-[0_12px_30px_rgba(0,0,0,0.55)]",
    saveBtn: "bg-white text-black",
    micBtn: "bg-neutral-800 border border-neutral-700 text-neutral-300",
    accent: "text-blue-400",
  },
  glow: {
    name: "C · Neon Glow",
    blurb: "Dark blurred pill with a colored glow ring around active icon + Theo orb.",
    dock: "bg-black/70 backdrop-blur-xl border border-white/10 shadow-[0_0_40px_rgba(99,102,241,0.25)]",
    iconActive: "text-white drop-shadow-[0_0_8px_rgba(129,140,248,0.9)]",
    iconIdle: "text-white/40",
    smartDock: "bg-black/75 backdrop-blur-xl border border-indigo-500/30 shadow-[0_0_50px_rgba(99,102,241,0.3)]",
    saveBtn: "bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.6)]",
    micBtn: "bg-white/5 border border-indigo-500/40 text-indigo-300",
    accent: "text-indigo-300",
  },
};

/* ============================================================
   DOCK VARIANTS
   ============================================================ */
function PillDock({ style, activeIdx = 0, dim = false }: { style: Style; activeIdx?: number; dim?: boolean }) {
  const S = STYLES[style];
  return (
    <div className="mx-auto w-[92%]">
      <div
        className={cn(
          "h-[60px] rounded-full px-3 flex items-center justify-between",
          S.dock,
          dim && "opacity-70",
        )}
      >
        {TABS.map((T, i) => (
          <button
            key={T.label}
            className={cn(
              "w-10 h-10 flex items-center justify-center rounded-full transition-colors",
              i === activeIdx ? S.iconActive : S.iconIdle,
            )}
          >
            <T.icon className="w-[22px] h-[22px]" strokeWidth={i === activeIdx ? 2.5 : 2} />
          </button>
        ))}
        <div className={cn(style === "glow" && "rounded-full ring-2 ring-indigo-400/60 shadow-[0_0_15px_rgba(99,102,241,0.7)]")}>
          <TheoOrb size={40} className="text-white" />
        </div>
      </div>
    </div>
  );
}

function SmartDock({ style }: { style: Style }) {
  const S = STYLES[style];
  return (
    <div className="mx-auto w-[94%]">
      <div className={cn("rounded-[28px] p-3.5 space-y-3", S.smartDock)}>
        <div className="flex items-center justify-between px-1">
          <div>
            <div className="text-[9px] text-white/40 uppercase tracking-wider">Total Value</div>
            <div className="text-lg font-bold leading-tight text-white">$4,285.50</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-white/40 uppercase tracking-wider">Counted</div>
            <div className="text-sm font-semibold text-white">
              45 <span className="text-white/40 font-normal">/ 120</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-white/40 uppercase tracking-wider">Timer</div>
            <div className={cn("text-sm font-mono", S.accent)}>08:42</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className={cn("h-11 w-11 rounded-full flex items-center justify-center shrink-0", S.micBtn)}>
            <Mic className="w-5 h-5" />
          </button>
          <button className={cn("flex-1 h-11 text-sm font-semibold rounded-full", S.saveBtn)}>
            Save Count
          </button>
          <div className={cn("shrink-0", style === "glow" && "rounded-full ring-2 ring-indigo-400/60 shadow-[0_0_15px_rgba(99,102,241,0.7)]")}>
            <TheoOrb size={44} className="text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PHONE SCREENS
   ============================================================ */
function DashboardScreen({ style }: { style: Style }) {
  return (
    <div className="absolute inset-0 bg-neutral-950 text-white flex flex-col">
      <div className="p-4 pt-8 space-y-4 flex-1 overflow-hidden">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-[10px] text-white/40">Palm Springs</div>
            <h1 className="text-lg font-bold">Dashboard</h1>
          </div>
          <div className="w-8 h-8 rounded-full bg-neutral-800" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="h-20 rounded-2xl bg-gradient-to-br from-emerald-900/40 to-neutral-900 border border-white/5 p-2.5">
            <div className="text-[9px] text-white/40 uppercase">Sales</div>
            <div className="text-base font-bold">$12,480</div>
          </div>
          <div className="h-20 rounded-2xl bg-gradient-to-br from-blue-900/40 to-neutral-900 border border-white/5 p-2.5">
            <div className="text-[9px] text-white/40 uppercase">Labor</div>
            <div className="text-base font-bold">28.4%</div>
          </div>
        </div>
        <div className="h-24 rounded-2xl bg-neutral-900/60 border border-white/5" />
        <div className="h-20 rounded-2xl bg-neutral-900/60 border border-white/5" />
      </div>
      <div className="pb-5">
        <PillDock style={style} activeIdx={0} />
      </div>
    </div>
  );
}

function InventoryScreen({ style }: { style: Style }) {
  return (
    <div className="absolute inset-0 bg-neutral-950 text-white flex flex-col">
      <div className="p-4 pt-8 flex-1 overflow-hidden">
        <h1 className="text-sm font-semibold mb-3">Bar — Walk-in</h1>
        <div className="space-y-2">
          {["Tito's Vodka 1L", "Jameson 750ml", "Casamigos Blanco", "Hendricks Gin"].map((n, i) => (
            <div
              key={n}
              className={cn(
                "h-11 rounded-xl border flex items-center justify-between px-3",
                i === 1
                  ? "bg-blue-500/10 border-blue-500/40"
                  : "bg-neutral-900/60 border-white/5",
              )}
            >
              <span className="text-xs">{n}</span>
              <span className={cn("text-xs font-mono", i === 1 ? "text-blue-300" : "text-white/40")}>
                {i === 1 ? "--" : (2 + i).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="pb-5">
        <SmartDock style={style} />
      </div>
    </div>
  );
}

function SwipedScreen({ style }: { style: Style }) {
  return (
    <div className="absolute inset-0 bg-neutral-950 text-white">
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute bottom-0 inset-x-0 top-[14%] bg-neutral-900 rounded-t-[32px] border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.7)] flex flex-col">
        <div className="w-10 h-1.5 bg-white/15 rounded-full mx-auto mt-3 mb-3" />
        <div className="px-4 flex-1 overflow-hidden">
          <div className="flex items-center gap-2.5 mb-4">
            <TheoOrb size={36} className="text-white" />
            <div>
              <h2 className="text-sm font-bold">Theo Insights</h2>
              <p className="text-[10px] text-white/50">Manager Dashboard</p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="p-3 bg-white/5 rounded-2xl border border-white/5">
              <div className="text-[9px] text-amber-400 font-semibold uppercase mb-1">Labor Alert</div>
              <p className="text-[11px] text-white/80 leading-relaxed">
                Weekly labor up 4.2% vs last month.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 bg-white/5 rounded-2xl border border-white/5">
                <div className="text-[9px] text-white/40 uppercase">COGS</div>
                <div className="text-sm font-semibold">28.4%</div>
              </div>
              <div className="p-2.5 bg-white/5 rounded-2xl border border-white/5">
                <div className="text-[9px] text-white/40 uppercase">Rev</div>
                <div className="text-sm font-semibold">$42.1k</div>
              </div>
            </div>
          </div>
        </div>
        <div className="pb-5">
          <PillDock style={style} activeIdx={0} dim />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE
   ============================================================ */
function PhoneFrame({ style, state }: { style: Style; state: State }) {
  return (
    <div
      className="relative bg-neutral-950 rounded-[36px] border-[5px] border-neutral-800 shadow-2xl overflow-hidden"
      style={{ width: 260, height: 540 }}
    >
      {state === "dashboard" && <DashboardScreen style={style} />}
      {state === "inventory" && <InventoryScreen style={style} />}
      {state === "swiped" && <SwipedScreen style={style} />}
    </div>
  );
}

export default function DockPreview() {
  const [state, setState] = useState<State>("dashboard");

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Dock Style Comparison</h1>
            <p className="text-sm text-muted-foreground">
              Same dock, same data, same behavior — three visual treatments. Pick the one you like.
            </p>
          </div>
          <div className="inline-flex rounded-full bg-muted p-1 text-xs font-medium">
            {(["dashboard", "inventory", "swiped"] as State[]).map((s) => (
              <button
                key={s}
                onClick={() => setState(s)}
                className={cn(
                  "px-4 py-2 rounded-full capitalize transition-colors",
                  state === s ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                {s === "swiped" ? "Swiped Up" : s}
              </button>
            ))}
          </div>
        </header>

        {/* Three styles side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {(Object.keys(STYLES) as Style[]).map((style) => (
            <div
              key={style}
              className="rounded-3xl border border-border bg-neutral-900/30 p-5 flex flex-col items-center gap-4"
            >
              <div className="text-center">
                <h3 className="text-base font-bold">{STYLES[style].name}</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">{STYLES[style].blurb}</p>
              </div>
              <PhoneFrame style={style} state={state} />
              {/* Isolated dock swatch so you can see just the pill */}
              <div className="w-full bg-neutral-950 rounded-2xl p-4 pt-6 pb-6">
                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-3 text-center">
                  Dock only
                </p>
                {state === "inventory" ? (
                  <SmartDock style={style} />
                ) : (
                  <PillDock style={style} activeIdx={0} />
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Tell me <strong>A</strong>, <strong>B</strong>, or <strong>C</strong> and I'll apply that style to the real dock.
        </p>
      </div>
    </div>
  );
}

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
   THREE STYLES — all built on system tokens
   bg / foreground / primary / accent / border / muted
   ============================================================ */
const STYLES: Record<Style, {
  name: string;
  blurb: string;
  dock: string;
  iconActive: string;
  iconIdle: string;
  smartDock: string;
  saveBtn: string;
  micBtn: string;
  accent: string;
}> = {
  frosted: {
    name: "A · Frosted Orange",
    blurb: "Translucent accent (orange) with blur + hairline highlight. Instagram-style pill in your brand color.",
    dock: "bg-accent/85 backdrop-blur-2xl border border-white/15 shadow-[0_8px_30px_hsl(var(--accent)/0.35)]",
    iconActive: "text-accent-foreground",
    iconIdle: "text-accent-foreground/60",
    smartDock: "bg-accent/85 backdrop-blur-2xl border border-white/15 shadow-[0_8px_30px_hsl(var(--accent)/0.35)]",
    saveBtn: "bg-accent-foreground text-accent",
    micBtn: "bg-white/15 border border-white/25 text-accent-foreground",
    accent: "text-accent-foreground",
  },
  solid: {
    name: "B · Solid Orange",
    blurb: "Opaque accent pill, no blur, soft drop shadow. Matches today's dock color, just floating.",
    dock: "bg-accent border border-white/10 shadow-[0_10px_24px_hsl(var(--accent)/0.4)]",
    iconActive: "text-accent-foreground",
    iconIdle: "text-accent-foreground/55",
    smartDock: "bg-accent border border-white/10 shadow-[0_10px_24px_hsl(var(--accent)/0.4)]",
    saveBtn: "bg-accent-foreground text-accent",
    micBtn: "bg-white/15 border border-white/25 text-accent-foreground",
    accent: "text-accent-foreground",
  },
  glow: {
    name: "C · Orange Glow",
    blurb: "Translucent accent with a stronger glow halo on the active icon + Theo orb.",
    dock: "bg-accent/80 backdrop-blur-xl border border-white/20 shadow-[0_0_50px_hsl(var(--accent)/0.55)]",
    iconActive: "text-accent-foreground drop-shadow-[0_0_10px_hsl(0_0%_100%/0.9)]",
    iconIdle: "text-accent-foreground/55",
    smartDock: "bg-accent/85 backdrop-blur-xl border border-white/20 shadow-[0_0_50px_hsl(var(--accent)/0.55)]",
    saveBtn: "bg-accent-foreground text-accent shadow-[0_0_18px_hsl(0_0%_100%/0.5)]",
    micBtn: "bg-white/15 border border-white/30 text-accent-foreground",
    accent: "text-accent-foreground",
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
        <div className={cn(style === "glow" && "rounded-full ring-2 ring-accent/60 shadow-[0_0_15px_hsl(var(--accent)/0.6)]")}>
          <TheoOrb size={40} />
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
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Total Value</div>
            <div className="text-lg font-bold leading-tight text-foreground">$4,285.50</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Counted</div>
            <div className="text-sm font-semibold text-foreground">
              45 <span className="text-muted-foreground font-normal">/ 120</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Timer</div>
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
          <div className={cn("shrink-0", style === "glow" && "rounded-full ring-2 ring-accent/60 shadow-[0_0_15px_hsl(var(--accent)/0.6)]")}>
            <TheoOrb size={44} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PHONE SCREENS — use app's actual theme tokens
   ============================================================ */
function DashboardScreen({ style }: { style: Style }) {
  return (
    <div className="absolute inset-0 bg-background text-foreground flex flex-col">
      <div className="p-4 pt-8 space-y-4 flex-1 overflow-hidden">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-[10px] text-muted-foreground">Palm Springs</div>
            <h1 className="text-lg font-bold">Dashboard</h1>
          </div>
          <div className="w-8 h-8 rounded-full bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="h-20 rounded-2xl bg-card border border-border p-2.5">
            <div className="text-[9px] text-muted-foreground uppercase">Sales</div>
            <div className="text-base font-bold">$12,480</div>
          </div>
          <div className="h-20 rounded-2xl bg-card border border-border p-2.5">
            <div className="text-[9px] text-muted-foreground uppercase">Labor</div>
            <div className="text-base font-bold">28.4%</div>
          </div>
        </div>
        <div className="h-24 rounded-2xl bg-card border border-border" />
        <div className="h-20 rounded-2xl bg-card border border-border" />
      </div>
      <div className="pb-5">
        <PillDock style={style} activeIdx={0} />
      </div>
    </div>
  );
}

function InventoryScreen({ style }: { style: Style }) {
  return (
    <div className="absolute inset-0 bg-background text-foreground flex flex-col">
      <div className="p-4 pt-8 flex-1 overflow-hidden">
        <h1 className="text-sm font-semibold mb-3">Bar — Walk-in</h1>
        <div className="space-y-2">
          {["Tito's Vodka 1L", "Jameson 750ml", "Casamigos Blanco", "Hendricks Gin"].map((n, i) => (
            <div
              key={n}
              className={cn(
                "h-11 rounded-xl border flex items-center justify-between px-3",
                i === 1
                  ? "bg-primary/10 border-primary/40"
                  : "bg-card border-border",
              )}
            >
              <span className="text-xs">{n}</span>
              <span className={cn("text-xs font-mono", i === 1 ? "text-primary" : "text-muted-foreground")}>
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
    <div className="absolute inset-0 bg-background text-foreground">
      <div className="absolute inset-0 bg-foreground/30" />
      <div className="absolute bottom-0 inset-x-0 top-[14%] bg-card rounded-t-[32px] border-t border-border shadow-2xl flex flex-col">
        <div className="w-10 h-1.5 bg-muted-foreground/20 rounded-full mx-auto mt-3 mb-3" />
        <div className="px-4 flex-1 overflow-hidden">
          <div className="flex items-center gap-2.5 mb-4">
            <TheoOrb size={36} />
            <div>
              <h2 className="text-sm font-bold">Theo Insights</h2>
              <p className="text-[10px] text-muted-foreground">Manager Dashboard</p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="p-3 bg-muted/40 rounded-2xl border border-border">
              <div className="text-[9px] text-accent font-semibold uppercase mb-1">Labor Alert</div>
              <p className="text-[11px] text-foreground/80 leading-relaxed">
                Weekly labor up 4.2% vs last month.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 bg-muted/40 rounded-2xl border border-border">
                <div className="text-[9px] text-muted-foreground uppercase">COGS</div>
                <div className="text-sm font-semibold">28.4%</div>
              </div>
              <div className="p-2.5 bg-muted/40 rounded-2xl border border-border">
                <div className="text-[9px] text-muted-foreground uppercase">Rev</div>
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

function PhoneFrame({ style, state }: { style: Style; state: State }) {
  return (
    <div
      className="relative bg-background rounded-[36px] border-[5px] border-border shadow-2xl overflow-hidden"
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
              Three Instagram-pill treatments using your system colors.
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {(Object.keys(STYLES) as Style[]).map((style) => (
            <div
              key={style}
              className="rounded-3xl border border-border bg-muted/30 p-5 flex flex-col items-center gap-4"
            >
              <div className="text-center">
                <h3 className="text-base font-bold">{STYLES[style].name}</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">{STYLES[style].blurb}</p>
              </div>
              <PhoneFrame style={style} state={state} />
              <div className="w-full bg-background border border-border rounded-2xl p-4 pt-6 pb-6">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-3 text-center">
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

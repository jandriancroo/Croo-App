import { Minus, Plus, ChevronLeft, ChevronRight, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────────
const mockItems = [
  {
    name: "PEPPERS GREEN JULIENNE",
    packSize: "5#",
    itemNumber: "48291",
    costPerCase: 24.30,
    storageLocation: "Walk-in Cooler",
    panSizes: [
      { label: "Full Pan", unitsEach: 12 },
      { label: "Half Pan", unitsEach: 6 },
      { label: "Third Pan", unitsEach: 4 },
    ],
    cases: 3,
    units: 2,
    packQuantity: 6,
    totalCost: 72.90,
  },
  {
    name: "CHICKEN BREAST 6OZ",
    packSize: "40ct",
    itemNumber: "10442",
    costPerCase: 89.50,
    storageLocation: "Walk-in Freezer",
    panSizes: [
      { label: "Full Pan", unitsEach: 24 },
      { label: "Half Pan", unitsEach: 12 },
    ],
    cases: 2,
    units: 8,
    packQuantity: 40,
    totalCost: 179.00,
  },
];

// ─────────────────────────────────────────────
// SHARED: Location Nav Bar
// ─────────────────────────────────────────────
const LocationNav = ({ className, textClass }: { className?: string; textClass?: string }) => (
  <div className={cn("flex items-center justify-between p-2", className)}>
    <button className={cn("h-9 w-9 flex items-center justify-center rounded-md", textClass)}>
      <ChevronLeft className="h-5 w-5" />
    </button>
    <div className="text-center">
      <p className={cn("font-semibold text-sm", textClass)}>Walk-in Cooler</p>
      <p className={cn("text-xs opacity-60", textClass)}>1 of 3</p>
    </div>
    <button className={cn("h-9 w-9 flex items-center justify-center rounded-md", textClass)}>
      <ChevronRight className="h-5 w-5" />
    </button>
  </div>
);

// ─────────────────────────────────────────────
// SHARED: Sharp Counter (Option 6 derived, no rounded-full)
// ─────────────────────────────────────────────
const SharpCounter = ({ label, value, height = "h-12", textSize = "text-2xl", borderClass = "border-border", bgClass = "bg-background" }: {
  label: string; value: number; height?: string; textSize?: string; borderClass?: string; bgClass?: string;
}) => (
  <div>
    <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider">{label}</p>
    <div className={cn("flex items-center rounded-lg overflow-hidden border", borderClass, bgClass)}>
      <button className={cn("flex items-center justify-center text-muted-foreground border-r border-inherit active:bg-muted transition-colors flex-shrink-0", height, "w-11")}>
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        defaultValue={value}
        className={cn("flex-1 text-center font-bold text-foreground tabular-nums bg-transparent outline-none w-0", textSize)}
      />
      <button className={cn("flex items-center justify-center text-muted-foreground border-l border-inherit active:bg-muted transition-colors flex-shrink-0", height, "w-11")}>
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  </div>
);

// Small pan counter
const PanCounter = ({ label, unitsEach, value = 0, borderClass = "border-border" }: {
  label: string; unitsEach: number; value?: number; borderClass?: string;
}) => (
  <div className="text-center">
    <p className="text-[9px] text-muted-foreground font-medium mb-1 truncate">{label} ({unitsEach})</p>
    <div className={cn("flex items-center bg-background rounded-md border overflow-hidden", borderClass)}>
      <button className="h-8 w-8 flex items-center justify-center text-muted-foreground active:bg-muted transition-colors flex-shrink-0">
        <Minus className="h-3 w-3" />
      </button>
      <input type="text" inputMode="numeric" defaultValue={value} className="flex-1 text-center text-sm font-bold bg-transparent outline-none w-0" />
      <button className="h-8 w-8 flex items-center justify-center text-muted-foreground active:bg-muted transition-colors flex-shrink-0">
        <Plus className="h-3 w-3" />
      </button>
    </div>
  </div>
);


// ─────────────────────────────────────────────
// OPTION 1 — CURRENT (Updated with Option 6 counters)
// Primary-header card, rounded counters, compact pans
// ─────────────────────────────────────────────
const Option1Current = () => (
  <div className="space-y-3">
    <LocationNav className="bg-primary rounded-lg" textClass="text-primary-foreground" />

    {mockItems.map((item, i) => (
      <div key={i} className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="p-3 bg-primary text-primary-foreground">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate">{item.name}</p>
              <div className="flex flex-wrap gap-x-3 text-xs text-primary-foreground/70 mt-1">
                <span>#{item.itemNumber}</span>
                <span>{item.packSize}</span>
                <span className="text-primary-foreground font-medium">${item.costPerCase}/case</span>
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-3">
              <p className="text-2xl font-bold">${item.totalCost.toFixed(2)}</p>
              <p className="text-xs text-primary-foreground/70">{item.cases * item.packQuantity + item.units} units</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <SharpCounter label="Cases" value={item.cases} />
            <SharpCounter label={`Units (${item.packQuantity}/case)`} value={item.units} />
          </div>
          <div className="mt-3 pt-3 border-t border-border/40">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Pan / Cambro Sizes</p>
            <div className="grid grid-cols-3 gap-2">
              {item.panSizes.map((pan, pi) => (
                <PanCounter key={pi} label={pan.label} unitsEach={pan.unitsEach} />
              ))}
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);


// ─────────────────────────────────────────────
// OPTION 2 — "Ledger"
// Financial-grade: monochrome header, sharp edges,
// thin ruled lines, value-first hierarchy
// ─────────────────────────────────────────────
const Option2Ledger = () => (
  <div className="space-y-3">
    <LocationNav className="bg-foreground rounded-md" textClass="text-background" />

    {mockItems.map((item, i) => (
      <div key={i} className="bg-card rounded-md border border-border overflow-hidden">
        {/* Dark monochrome header — sharp, no radius */}
        <div className="px-4 py-3 bg-foreground text-background">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm tracking-tight truncate">{item.name}</p>
              <div className="flex items-center gap-2 text-[11px] text-background/50 mt-1 font-mono">
                <span>#{item.itemNumber}</span>
                <span className="text-background/20">|</span>
                <span>{item.packSize}</span>
                <span className="text-background/20">|</span>
                <span>${item.costPerCase}/cs</span>
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-4">
              <p className="text-2xl font-black tabular-nums tracking-tight">${item.totalCost.toFixed(2)}</p>
              <p className="text-[10px] text-background/50 font-mono">{item.cases * item.packQuantity + item.units} units</p>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <SharpCounter label="Cases" value={item.cases} borderClass="border-foreground/20" />
            <SharpCounter label={`Units (${item.packQuantity}/case)`} value={item.units} borderClass="border-foreground/20" />
          </div>
          <div className="mt-3 pt-3 border-t border-foreground/10">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-2">Pan / Cambro</p>
            <div className="grid grid-cols-3 gap-2">
              {item.panSizes.map((pan, pi) => (
                <PanCounter key={pi} label={pan.label} unitsEach={pan.unitsEach} borderClass="border-foreground/15" />
              ))}
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);


// ─────────────────────────────────────────────
// OPTION 3 — "Vault"
// Banking-app inspired: muted header with left accent bar,
// value prominently displayed, clinical precision
// ─────────────────────────────────────────────
const Option3Vault = () => (
  <div className="space-y-3">
    <LocationNav className="bg-muted border border-border rounded-md" textClass="text-foreground" />

    {mockItems.map((item, i) => (
      <div key={i} className="bg-card rounded-md border border-border overflow-hidden flex">
        {/* Left accent bar */}
        <div className="w-1 bg-primary flex-shrink-0" />

        <div className="flex-1 min-w-0">
          {/* Header — subtle, not colored */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground truncate">{item.name}</p>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
                  <span className="font-mono">#{item.itemNumber}</span>
                  <span className="text-border">·</span>
                  <span>{item.packSize}</span>
                  <span className="text-border">·</span>
                  <span>${item.costPerCase}/cs</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <div className="flex items-center gap-1 justify-end">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <p className="text-2xl font-black text-foreground tabular-nums">{item.totalCost.toFixed(2)}</p>
                </div>
                <p className="text-[10px] text-muted-foreground tabular-nums">{item.cases * item.packQuantity + item.units} units on hand</p>
              </div>
            </div>
          </div>

          <div className="p-4">
            <div className="grid grid-cols-2 gap-3">
              <SharpCounter label="Cases" value={item.cases} />
              <SharpCounter label={`Units (${item.packQuantity}/case)`} value={item.units} />
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-2">Pan / Cambro</p>
              <div className="grid grid-cols-3 gap-2">
                {item.panSizes.map((pan, pi) => (
                  <PanCounter key={pi} label={pan.label} unitsEach={pan.unitsEach} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);


// ─────────────────────────────────────────────
// OPTION 4 — "Terminal"
// Dark-on-light contrast, monospaced numbers,
// squared edges, minimal color — like a POS terminal
// ─────────────────────────────────────────────
const Option4Terminal = () => (
  <div className="space-y-2">
    <LocationNav className="bg-foreground rounded-none" textClass="text-background" />

    {mockItems.map((item, i) => (
      <div key={i} className="bg-card border border-border overflow-hidden rounded-none">
        {/* Tight header — no border-radius, hard lines */}
        <div className="px-3 py-2.5 bg-muted border-b border-border">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm text-foreground truncate tracking-tight">{item.name}</p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                #{item.itemNumber} · {item.packSize} · ${item.costPerCase}/cs
              </p>
            </div>
            <div className="text-right flex-shrink-0 ml-3 bg-foreground text-background px-3 py-1.5 rounded-sm">
              <p className="text-lg font-black font-mono tabular-nums leading-none">${item.totalCost.toFixed(2)}</p>
              <p className="text-[9px] text-background/60 font-mono">{item.cases * item.packQuantity + item.units} units</p>
            </div>
          </div>
        </div>

        <div className="p-3">
          <div className="grid grid-cols-2 gap-2">
            <SharpCounter label="CASES" value={item.cases} height="h-11" borderClass="border-foreground/25" />
            <SharpCounter label={`UNITS (${item.packQuantity}/CS)`} value={item.units} height="h-11" borderClass="border-foreground/25" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mb-1.5">Pans</p>
            <div className="grid grid-cols-3 gap-1.5">
              {item.panSizes.map((pan, pi) => (
                <PanCounter key={pi} label={pan.label} unitsEach={pan.unitsEach} borderClass="border-foreground/20" />
              ))}
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);


// ─────────────────────────────────────────────
// OPTION 6 — "Vault × Terminal" Combo
// Left accent bar from Vault + dark value badge from Terminal
// + tight spacing, mono numbers, squared edges
// ─────────────────────────────────────────────
const Option6Combo = () => (
  <div className="space-y-2">
    <LocationNav className="bg-muted border border-border rounded-md" textClass="text-foreground" />

    {mockItems.map((item, i) => (
      <div key={i} className="bg-card rounded-md border border-border overflow-hidden flex">
        {/* Left accent bar (Vault) */}
        <div className="w-1 bg-primary flex-shrink-0" />

        <div className="flex-1 min-w-0">
          {/* Header: Vault's clean layout + Terminal's dark value badge */}
          <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm text-foreground truncate tracking-tight">{item.name}</p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                #{item.itemNumber} · {item.packSize} · ${item.costPerCase}/cs
              </p>
            </div>
          </div>
          {/* Value badge hugging top-right corner */}
          <div className="relative">
            <div className="absolute -top-5 right-3 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg shadow-sm">
              <p className="text-[15px] font-semibold tabular-nums leading-tight tracking-tight">${item.totalCost.toFixed(2)}</p>
              <p className="text-[9px] text-primary-foreground/70 text-center">{item.cases * item.packQuantity + item.units} units</p>
            </div>
          </div>

          <div className="p-3 pt-5">
            <div className="grid grid-cols-2 gap-2">
              <SharpCounter label="Cases" value={item.cases} height="h-11" borderClass="border-foreground/20" />
              <SharpCounter label={`Units (${item.packQuantity}/case)`} value={item.units} height="h-11" borderClass="border-foreground/20" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mb-1.5">Pan / Cambro</p>
              <div className="grid grid-cols-3 gap-1.5">
                {item.panSizes.map((pan, pi) => (
                  <PanCounter key={pi} label={pan.label} unitsEach={pan.unitsEach} borderClass="border-foreground/15" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────
// OPTION 5 — "Executive"
// Premium feel: subtle primary tint in header,
// generous spacing, clean type hierarchy, soft borders
// ─────────────────────────────────────────────
const Option5Executive = () => (
  <div className="space-y-3">
    <LocationNav className="bg-primary/10 border border-primary/20 rounded-lg" textClass="text-foreground" />

    {mockItems.map((item, i) => (
      <div key={i} className="bg-card rounded-lg border border-border overflow-hidden shadow-sm">
        {/* Tinted header — not full primary, just a hint */}
        <div className="px-4 py-3.5 bg-primary/5 border-b border-primary/10">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[15px] text-foreground truncate leading-tight">{item.name}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{item.packSize}</span>
                <span className="text-[11px] text-muted-foreground">#{item.itemNumber}</span>
                <span className="text-[11px] text-muted-foreground">${item.costPerCase}/case</span>
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Value</p>
              <p className="text-2xl font-black text-foreground tabular-nums tracking-tight">${item.totalCost.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground tabular-nums">{item.cases * item.packQuantity + item.units} units</p>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <SharpCounter label="Cases" value={item.cases} borderClass="border-border" />
            <SharpCounter label={`Units (${item.packQuantity}/case)`} value={item.units} borderClass="border-border" />
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-2">Pan / Cambro Sizes</p>
            <div className="grid grid-cols-3 gap-2">
              {item.panSizes.map((pan, pi) => (
                <PanCounter key={pi} label={pan.label} unitsEach={pan.unitsEach} />
              ))}
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);


// ─────────────────────────────────────────────
// MAIN PREVIEW PAGE
// ─────────────────────────────────────────────
const InventoryCountUIPreview = () => {
  return (
    <div className="min-h-screen bg-background p-4 max-w-md mx-auto space-y-10 pb-20">
      <div>
        <h1 className="text-xl font-bold text-foreground">Inventory Count · UI Refinements</h1>
        <p className="text-sm text-muted-foreground mt-1">Professional-grade variations · Sharp edges · Financial confidence</p>
      </div>

      <Section num={1} label="Current" desc="Production CrooHQ — primary header with rounded counters">
        <Option1Current />
      </Section>

      <Section num={2} label="Ledger" desc="Monochrome header, ruled lines, financial-grade typography">
        <Option2Ledger />
      </Section>

      <Section num={3} label="Vault" desc="Left accent bar, muted header, banking-app precision">
        <Option3Vault />
      </Section>

      <Section num={4} label="Terminal" desc="Squared edges, POS-style value badge, zero decoration">
        <Option4Terminal />
      </Section>

      <Section num={5} label="Executive" desc="Subtle primary tint, generous spacing, premium hierarchy">
        <Option5Executive />
      </Section>

      <Section num={6} label="Vault × Terminal" desc="Left accent bar + dark value badge, tight mono layout">
        <Option6Combo />
      </Section>
    </div>
  );
};

const Section = ({ num, label, desc, children }: { num: number; label: string; desc: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <div>
      <div className="flex items-center gap-2">
        <span className="h-6 w-6 rounded-md bg-foreground text-background text-xs font-bold flex items-center justify-center">{num}</span>
        <h2 className="text-sm font-bold text-foreground tracking-tight">{label}</h2>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5 ml-8">{desc}</p>
    </div>
    {children}
  </div>
);

export default InventoryCountUIPreview;

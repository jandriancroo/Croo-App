import { Minus, Plus, ChevronLeft, ChevronRight, Search, Package, Hash, DollarSign, Check, ChevronDown, Layers, Grid3X3 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

// ─────────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────────
const mockItems = [
  {
    name: "PEPPERS GREEN JULIENNE",
    packSize: "5#",
    itemNumber: "48291",
    costPerCase: 24.30,
    category: "Produce",
    storageLocation: "Walk-in Cooler",
    panSizes: [
      { label: "Full Pan", unitsEach: 12 },
      { label: "Half Pan", unitsEach: 6 },
      { label: "Third Pan", unitsEach: 4 },
    ],
    cases: 3,
    units: 2,
    unitLabel: "bags",
    packQuantity: 6,
    totalCost: 72.90,
  },
  {
    name: "CHICKEN BREAST 6OZ",
    packSize: "40ct",
    itemNumber: "10442",
    costPerCase: 89.50,
    category: "Protein",
    storageLocation: "Walk-in Freezer",
    panSizes: [
      { label: "Full Pan", unitsEach: 24 },
      { label: "Half Pan", unitsEach: 12 },
    ],
    cases: 2,
    units: 8,
    unitLabel: "pieces",
    packQuantity: 40,
    totalCost: 179.00,
  },
  {
    name: "TORTILLA FLOUR 12IN",
    packSize: "12ct",
    itemNumber: "77103",
    costPerCase: 14.75,
    category: "Dry Goods",
    storageLocation: "Dry Storage",
    panSizes: [
      { label: "Full Pan", unitsEach: 48 },
      { label: "Sixth Pan", unitsEach: 8 },
    ],
    cases: 5,
    units: 4,
    unitLabel: "packs",
    packQuantity: 12,
    totalCost: 73.75,
  },
];

const storageLocations = ["Walk-in Cooler", "Walk-in Freezer", "Dry Storage"];

// ─────────────────────────────────────────────
// OPTION 1 — CURRENT UI (CrooHQ Production)
// Primary-header card with pill steppers for Cases/Units + Pan rows
// ─────────────────────────────────────────────
const Option1Current = () => (
  <div className="space-y-3">
    {/* Location nav */}
    <div className="flex items-center justify-between bg-primary text-primary-foreground rounded-lg p-2">
      <button className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-primary-foreground/20">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="text-center">
        <p className="font-medium text-sm">Walk-in Cooler</p>
        <p className="text-xs text-primary-foreground/70">1 of 3</p>
      </div>
      <button className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-primary-foreground/20">
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>

    {mockItems.slice(0, 2).map((item, i) => (
      <div key={i} className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        {/* Primary header */}
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
        {/* Rounded counters (Option 6 style) */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <RoundedCounter label="Cases" value={item.cases} />
            <RoundedCounter label={`Units (${item.packQuantity}/case)`} value={item.units} />
          </div>
          {/* Pan sizes */}
          <div className="mt-3 pt-3 border-t border-border/40">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Pan / Cambro Sizes</p>
            <div className="grid grid-cols-3 gap-2">
              {item.panSizes.map((pan, pi) => (
                <div key={pi} className="text-center">
                  <p className="text-[9px] text-muted-foreground font-medium mb-1 truncate">{pan.label} ({pan.unitsEach})</p>
                  <div className="flex items-center bg-background rounded-lg border border-border overflow-hidden">
                    <button className="h-8 w-8 flex items-center justify-center text-muted-foreground active:scale-95 flex-shrink-0">
                      <Minus className="h-3 w-3" />
                    </button>
                    <input type="text" inputMode="numeric" defaultValue="0" className="flex-1 text-center text-sm font-bold bg-transparent outline-none w-0" />
                    <button className="h-8 w-8 flex items-center justify-center text-primary active:scale-95 flex-shrink-0">
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────
// OPTION 2 — Toast POS: Swipe-Card Focus Mode
// One item at a time, big numpad-style entry, swipe between items
// ─────────────────────────────────────────────
const Option2Toast = () => {
  const [idx, setIdx] = useState(0);
  const item = mockItems[idx];

  return (
    <div className="space-y-3">
      {/* Progress strip */}
      <div className="flex items-center gap-2">
        <Progress value={((idx + 1) / mockItems.length) * 100} className="h-1.5 flex-1" />
        <span className="text-xs font-semibold text-muted-foreground">{idx + 1}/{mockItems.length}</span>
      </div>

      {/* Location badge */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-1 rounded-md uppercase tracking-wider">{item.storageLocation}</span>
        <span className="text-xs text-muted-foreground ml-auto">${item.totalCost.toFixed(2)} value</span>
      </div>

      {/* Focus card */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
        <div className="p-5 text-center space-y-1">
          <p className="text-lg font-bold text-foreground">{item.name}</p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="bg-muted px-2 py-0.5 rounded-md font-medium">{item.packSize}</span>
            <span>#{item.itemNumber}</span>
            <span>${item.costPerCase}/case</span>
          </div>
        </div>

        {/* Large count area */}
        <div className="bg-muted/30 border-t border-border p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <BigCounter label="CASES" value={item.cases} accent />
            <BigCounter label={`UNITS (${item.packQuantity}/case)`} value={item.units} />
          </div>

          {/* Pan sizes as chips */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Pan Counts</p>
            <div className="grid grid-cols-3 gap-2">
              {item.panSizes.map((pan, pi) => (
                <div key={pi} className="bg-background rounded-xl border border-border p-2 text-center">
                  <p className="text-[10px] text-muted-foreground font-medium truncate">{pan.label}</p>
                  <p className="text-[9px] text-muted-foreground/70">{pan.unitsEach}/ea</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    defaultValue="0"
                    className="w-full text-center text-lg font-bold text-foreground bg-transparent outline-none mt-0.5"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Nav buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setIdx(Math.max(0, idx - 1))}
          disabled={idx === 0}
          className="flex-1 h-12 rounded-xl bg-muted text-foreground font-semibold text-sm disabled:opacity-30 active:scale-95 transition-all"
        >
          ← Previous
        </button>
        <button
          onClick={() => setIdx(Math.min(mockItems.length - 1, idx + 1))}
          disabled={idx === mockItems.length - 1}
          className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-30 active:scale-95 transition-all"
        >
          {idx === mockItems.length - 1 ? "Done ✓" : "Next →"}
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// OPTION 3 — Square Register: Grid Tiles
// Compact grid with tap-to-expand, running total bar
// ─────────────────────────────────────────────
const Option3Square = () => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  return (
    <div className="space-y-3">
      {/* Running total sticky bar */}
      <div className="flex items-center justify-between bg-foreground text-background rounded-xl px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-background/60 font-semibold">Running Total</p>
          <p className="text-xl font-bold">$325.65</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-background/60 font-semibold">Items Counted</p>
          <p className="text-xl font-bold">2<span className="text-background/40 font-normal">/3</span></p>
        </div>
      </div>

      {/* Item tiles */}
      {mockItems.map((item, i) => {
        const isExpanded = expandedIdx === i;
        return (
          <div
            key={i}
            className={cn(
              "bg-card rounded-xl border overflow-hidden transition-all",
              isExpanded ? "border-primary shadow-md" : "border-border"
            )}
          >
            {/* Compact row — always visible */}
            <button
              className="w-full flex items-center gap-3 p-3 text-left"
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
            >
              <div className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold",
                item.cases > 0 || item.units > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {item.cases > 0 || item.units > 0 ? <Check className="h-5 w-5" /> : (i + 1)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                  <span>{item.packSize}</span>
                  <span className="text-muted-foreground/30">·</span>
                  <span>#{item.itemNumber}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-foreground">${item.totalCost.toFixed(2)}</p>
                <p className="text-[11px] text-muted-foreground">{item.cases}c · {item.units}u</p>
              </div>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
            </button>

            {/* Expanded panel */}
            {isExpanded && (
              <div className="border-t border-border p-4 space-y-4 bg-muted/20">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5" />
                  <span>${item.costPerCase}/case</span>
                  <span className="text-muted-foreground/30">·</span>
                  <Package className="h-3.5 w-3.5" />
                  <span>{item.packQuantity} per case</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SegmentedCounter label="Cases" value={item.cases} />
                  <SegmentedCounter label="Units" value={item.units} />
                </div>
                {/* Pans */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2 flex items-center gap-1">
                    <Layers className="h-3 w-3" /> Pan Sizes
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {item.panSizes.map((pan, pi) => (
                      <SegmentedCounter key={pi} label={`${pan.label} (${pan.unitsEach}/ea)`} value={0} small />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────
// OPTION 4 — Toast KDS: Split-Screen Speed Entry
// Top half = item info, bottom half = numpad-style entry
// ─────────────────────────────────────────────
const Option4KDS = () => {
  const [idx] = useState(0);
  const item = mockItems[idx];

  return (
    <div className="space-y-0 bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
      {/* Top: Item info strip */}
      <div className="bg-muted/40 p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider">{item.storageLocation}</span>
          <span className="text-[10px] text-muted-foreground font-semibold">Item 1 of 3</span>
        </div>
        <p className="text-base font-bold text-foreground">{item.name}</p>
        <div className="flex items-center gap-3 mt-2">
          <InfoChip icon={<Hash className="h-3 w-3" />} text={item.itemNumber} />
          <InfoChip icon={<Package className="h-3 w-3" />} text={item.packSize} />
          <InfoChip icon={<DollarSign className="h-3 w-3" />} text={`${item.costPerCase}/case`} />
        </div>
      </div>

      {/* Bottom: Entry area */}
      <div className="p-4 space-y-4">
        {/* Main counts — large touch targets */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-primary/5 border-2 border-primary/20 rounded-2xl p-4 text-center">
            <p className="text-[10px] text-primary font-bold uppercase tracking-wider mb-1">Cases</p>
            <input
              type="text"
              inputMode="numeric"
              defaultValue={item.cases}
              className="w-full text-center text-4xl font-black text-foreground bg-transparent outline-none"
            />
            <div className="flex items-center gap-1 mt-2">
              <button className="flex-1 h-10 rounded-lg bg-muted active:scale-95 transition-all flex items-center justify-center">
                <Minus className="h-4 w-4 text-muted-foreground" />
              </button>
              <button className="flex-1 h-10 rounded-lg bg-primary active:scale-95 transition-all flex items-center justify-center">
                <Plus className="h-4 w-4 text-primary-foreground" />
              </button>
            </div>
          </div>
          <div className="bg-muted/50 border-2 border-border rounded-2xl p-4 text-center">
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1">Units ({item.packQuantity}/case)</p>
            <input
              type="text"
              inputMode="numeric"
              defaultValue={item.units}
              className="w-full text-center text-4xl font-black text-foreground bg-transparent outline-none"
            />
            <div className="flex items-center gap-1 mt-2">
              <button className="flex-1 h-10 rounded-lg bg-muted active:scale-95 transition-all flex items-center justify-center">
                <Minus className="h-4 w-4 text-muted-foreground" />
              </button>
              <button className="flex-1 h-10 rounded-lg bg-primary active:scale-95 transition-all flex items-center justify-center">
                <Plus className="h-4 w-4 text-primary-foreground" />
              </button>
            </div>
          </div>
        </div>

        {/* Pan rows as horizontal scroll chips */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Pans</p>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {item.panSizes.map((pan, pi) => (
              <div key={pi} className="bg-muted/40 border border-border rounded-xl p-3 text-center min-w-[100px] flex-shrink-0">
                <p className="text-[10px] text-muted-foreground font-semibold">{pan.label}</p>
                <p className="text-[9px] text-muted-foreground/60">{pan.unitsEach} units/ea</p>
                <input
                  type="text"
                  inputMode="numeric"
                  defaultValue="0"
                  className="w-full text-center text-2xl font-bold text-foreground bg-transparent outline-none mt-1"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Running total */}
        <div className="flex items-center justify-between bg-foreground text-background rounded-xl px-4 py-3">
          <span className="text-sm font-medium">Item Value</span>
          <span className="text-lg font-bold">${item.totalCost.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// OPTION 5 — Square Inventory: Inline List Editor
// Flat list, inline editing, no card chrome, fast data entry
// ─────────────────────────────────────────────
const Option5InlineList = () => (
  <div className="space-y-3">
    {/* Search & filter */}
    <div className="flex items-center gap-2">
      <div className="flex-1 flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search items..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <button className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
        <Grid3X3 className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>

    {/* Location pill selector */}
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {storageLocations.map((loc, i) => (
        <button
          key={i}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors",
            i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          {loc}
        </button>
      ))}
    </div>

    {/* Items */}
    <div className="bg-card rounded-xl border border-border overflow-hidden divide-y divide-border">
      {mockItems.map((item, i) => (
        <div key={i} className="p-3 space-y-3">
          {/* Row 1: Name + value */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{item.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                <span>{item.packSize}</span>
                <span className="text-muted-foreground/30">·</span>
                <span>#{item.itemNumber}</span>
                <span className="text-muted-foreground/30">·</span>
                <span>${item.costPerCase}/cs</span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold text-foreground">${item.totalCost.toFixed(2)}</p>
            </div>
          </div>

          {/* Row 2: Inline counters */}
          <div className="flex items-end gap-2">
            <InlineField label="Cases" value={item.cases} />
            <InlineField label={`Units (${item.packQuantity}/cs)`} value={item.units} />
            {item.panSizes.slice(0, 2).map((pan, pi) => (
              <InlineField key={pi} label={`${pan.label.replace(' Pan', '')} (${pan.unitsEach})`} value={0} />
            ))}
          </div>
        </div>
      ))}
    </div>

    {/* Bottom total */}
    <div className="flex items-center justify-between px-1">
      <span className="text-sm text-muted-foreground font-medium">3 items · Walk-in Cooler</span>
      <span className="text-sm font-bold text-foreground">Total: $325.65</span>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// OPTION 6 — Toast Hybrid: Sectioned Card List
// Category headers, compact cards, sliding pan drawer
// ─────────────────────────────────────────────
const Option6Sectioned = () => (
  <div className="space-y-4">
    {/* Stats ribbon */}
    <div className="grid grid-cols-3 gap-2">
      <StatPill label="Counted" value="2/3" />
      <StatPill label="Value" value="$326" />
      <StatPill label="Time" value="4:32" />
    </div>

    {/* Category section */}
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-1 w-4 rounded-full bg-primary" />
        <span className="text-xs font-bold text-foreground uppercase tracking-wider">Produce</span>
        <span className="text-[10px] text-muted-foreground">1 item</span>
      </div>

      {mockItems.slice(0, 1).map((item, i) => (
        <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-3 p-3">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
              <p className="text-[11px] text-muted-foreground">{item.packSize} · ${item.costPerCase}/cs · #{item.itemNumber}</p>
            </div>
            <p className="text-base font-bold text-foreground flex-shrink-0">${item.totalCost.toFixed(2)}</p>
          </div>
          <div className="border-t border-border bg-muted/20 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <RoundedCounter label="Cases" value={item.cases} primary />
              <RoundedCounter label={`Units (${item.packQuantity}/cs)`} value={item.units} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {item.panSizes.map((pan, pi) => (
                <div key={pi} className="text-center">
                  <p className="text-[9px] text-muted-foreground font-medium mb-1 truncate">{pan.label} ({pan.unitsEach})</p>
                  <div className="flex items-center bg-background rounded-lg border border-border overflow-hidden">
                    <button className="h-8 w-8 flex items-center justify-center text-muted-foreground active:scale-95 flex-shrink-0">
                      <Minus className="h-3 w-3" />
                    </button>
                    <input type="text" inputMode="numeric" defaultValue="0" className="flex-1 text-center text-sm font-bold bg-transparent outline-none w-0" />
                    <button className="h-8 w-8 flex items-center justify-center text-primary active:scale-95 flex-shrink-0">
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>

    {/* Protein section */}
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-1 w-4 rounded-full bg-destructive" />
        <span className="text-xs font-bold text-foreground uppercase tracking-wider">Protein</span>
        <span className="text-[10px] text-muted-foreground">1 item</span>
      </div>

      {mockItems.slice(1, 2).map((item, i) => (
        <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-3 p-3">
            <div className="h-12 w-12 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0">
              <Package className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
              <p className="text-[11px] text-muted-foreground">{item.packSize} · ${item.costPerCase}/cs</p>
            </div>
            <p className="text-base font-bold text-foreground flex-shrink-0">${item.totalCost.toFixed(2)}</p>
          </div>
          <div className="border-t border-border bg-muted/20 p-3">
            <div className="grid grid-cols-2 gap-3">
              <RoundedCounter label="Cases" value={item.cases} primary />
              <RoundedCounter label={`Units (${item.packQuantity}/cs)`} value={item.units} />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);


// ─────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────

const PillStepper = ({ label, value }: { label: string; value: number }) => (
  <div className="flex-1">
    <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">{label}</p>
    <div className="flex items-center bg-muted/60 rounded-full overflow-hidden border border-border/50">
      <button className="h-11 w-11 flex items-center justify-center bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95 transition-all rounded-full flex-shrink-0">
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <input type="text" inputMode="numeric" defaultValue={value} className="flex-1 text-center text-xl font-bold text-foreground tabular-nums bg-transparent border-none outline-none w-0" />
      <button className="h-11 w-11 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all rounded-full flex-shrink-0">
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  </div>
);

const BigCounter = ({ label, value, accent }: { label: string; value: number; accent?: boolean }) => (
  <div className="text-center">
    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-2">{label}</p>
    <div className={cn(
      "rounded-2xl p-3 border-2",
      accent ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border"
    )}>
      <input
        type="text"
        inputMode="numeric"
        defaultValue={value}
        className="w-full text-center text-3xl font-black text-foreground bg-transparent outline-none"
      />
    </div>
    <div className="flex items-center gap-1 mt-2">
      <button className="flex-1 h-11 rounded-xl bg-muted active:scale-95 transition-all flex items-center justify-center">
        <Minus className="h-4 w-4 text-muted-foreground" strokeWidth={2.5} />
      </button>
      <button className={cn(
        "flex-1 h-11 rounded-xl active:scale-95 transition-all flex items-center justify-center",
        accent ? "bg-primary text-primary-foreground" : "bg-foreground text-background"
      )}>
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  </div>
);

const SegmentedCounter = ({ label, value, small }: { label: string; value: number; small?: boolean }) => (
  <div>
    <p className={cn("text-muted-foreground font-medium mb-1 truncate", small ? "text-[9px]" : "text-[10px]")}>{label}</p>
    <div className="flex items-center bg-background border border-border rounded-xl overflow-hidden">
      <button className={cn("flex items-center justify-center text-muted-foreground border-r border-border active:scale-95 active:bg-muted transition-all", small ? "h-9 w-9" : "h-11 w-11")}>
        <Minus className={cn(small ? "h-3 w-3" : "h-4 w-4")} strokeWidth={2.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        defaultValue={value}
        className={cn("flex-1 text-center font-bold text-foreground tabular-nums bg-transparent outline-none w-0", small ? "text-base" : "text-xl")}
      />
      <button className={cn("flex items-center justify-center text-primary border-l border-border active:scale-95 active:bg-primary/5 transition-all", small ? "h-9 w-9" : "h-11 w-11")}>
        <Plus className={cn(small ? "h-3 w-3" : "h-4 w-4")} strokeWidth={2.5} />
      </button>
    </div>
  </div>
);

const InlineField = ({ label, value }: { label: string; value: number }) => (
  <div className="flex-1 min-w-0">
    <p className="text-[9px] text-muted-foreground font-medium mb-1 truncate">{label}</p>
    <input
      type="text"
      inputMode="numeric"
      defaultValue={value}
      className="w-full h-9 text-center text-sm font-bold bg-muted rounded-lg border border-border/50 outline-none focus:ring-2 focus:ring-primary/30 transition-all"
    />
  </div>
);

const RoundedCounter = ({ label, value, primary }: { label: string; value: number; primary?: boolean }) => (
  <div>
    <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider">{label}</p>
    <div className={cn(
      "flex items-center rounded-xl overflow-hidden border",
      primary ? "border-primary/30 bg-primary/5" : "border-border bg-background"
    )}>
      <button className="h-12 w-12 flex items-center justify-center text-muted-foreground active:scale-95 transition-all border-r border-inherit flex-shrink-0">
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        defaultValue={value}
        className="flex-1 text-center text-2xl font-bold text-foreground tabular-nums bg-transparent outline-none w-0"
      />
      <button className={cn(
        "h-12 w-12 flex items-center justify-center active:scale-95 transition-all border-l border-inherit flex-shrink-0",
        primary ? "text-primary" : "text-foreground"
      )}>
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  </div>
);

const InfoChip = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
    {icon}
    {text}
  </span>
);

const StatPill = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-card border border-border rounded-xl p-2.5 text-center">
    <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
    <p className="text-base font-bold text-foreground mt-0.5">{value}</p>
  </div>
);


// ─────────────────────────────────────────────
// MAIN PREVIEW PAGE
// ─────────────────────────────────────────────
const InventoryCountUIPreview = () => {
  return (
    <div className="min-h-screen bg-background p-4 max-w-md mx-auto space-y-10 pb-20">
      <div>
        <h1 className="text-xl font-bold text-foreground">Inventory Count UI Options</h1>
        <p className="text-sm text-muted-foreground mt-1">Toast & Square-inspired · Mobile-first · Pan types visible</p>
      </div>

      <Section num={1} label="Current UI" desc="Production CrooHQ — primary header cards with pill steppers">
        <Option1Current />
      </Section>

      <Section num={2} label="Toast Focus Mode" desc="One item at a time, big touch targets, swipe navigation">
        <Option2Toast />
      </Section>

      <Section num={3} label="Square Accordion" desc="Compact list with tap-to-expand, running total bar">
        <Option3Square />
      </Section>

      <Section num={4} label="Toast KDS Entry" desc="Split layout — item info top, numpad-style entry bottom">
        <Option4KDS />
      </Section>

      <Section num={5} label="Square Inline List" desc="Flat list, all fields visible, minimal chrome">
        <Option5InlineList />
      </Section>

      <Section num={6} label="Toast Sectioned" desc="Category-grouped cards with stat ribbon">
        <Option6Sectioned />
      </Section>
    </div>
  );
};

const Section = ({ num, label, desc, children }: { num: number; label: string; desc: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <div>
      <div className="flex items-center gap-2">
        <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">{num}</span>
        <h2 className="text-sm font-bold text-foreground">{label}</h2>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5 ml-8">{desc}</p>
    </div>
    {children}
  </div>
);

export default InventoryCountUIPreview;

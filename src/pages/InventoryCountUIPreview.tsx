import { Minus, Plus, ChevronRight, Search, Package, Scale, ChevronDown, Check, X, MoreHorizontal } from "lucide-react";
import { useState } from "react";

// Mock data representing a typical counting session
const mockItems = [
  {
    name: "PEPPERS GREEN JULIENNE",
    packSize: "5#",
    itemNumber: "48291",
    costPerCase: 24.30,
    category: "Produce",
    storageLocation: "Walk-in Cooler",
    panSizes: ["Full", "Half", "Third"],
    currentPan: "Half",
    cases: 3,
    units: 2,
    unitLabel: "bags",
    totalCost: 72.90,
  },
  {
    name: "CHICKEN BREAST 6OZ",
    packSize: "40ct",
    itemNumber: "10442",
    costPerCase: 89.50,
    category: "Protein",
    storageLocation: "Walk-in Freezer",
    panSizes: ["Full", "Half"],
    currentPan: "Full",
    cases: 2,
    units: 8,
    unitLabel: "pieces",
    totalCost: 179.00,
  },
  {
    name: "TORTILLA FLOUR 12IN",
    packSize: "12ct",
    itemNumber: "77103",
    costPerCase: 14.75,
    category: "Dry Goods",
    storageLocation: "Dry Storage",
    panSizes: ["Full", "Half", "Sixth"],
    currentPan: "Sixth",
    cases: 5,
    units: 4,
    unitLabel: "packs",
    totalCost: 73.75,
  },
];

// ─────────────────────────────────────────────
// OPTION A — R365-Inspired: List-First Scanner
// Dense list with inline quantity entry, category headers, search
// ─────────────────────────────────────────────
const OptionA = () => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/30">
        <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          placeholder="Search items or scan barcode..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">3 items</span>
      </div>

      {/* Category header */}
      <div className="px-3 py-1.5 bg-primary/5 border-b border-border">
        <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">Produce</span>
      </div>

      {/* Item rows */}
      {mockItems.map((item, i) => (
        <div
          key={i}
          className={`border-b border-border last:border-b-0 transition-colors ${activeIdx === i ? 'bg-primary/5' : ''}`}
          onClick={() => setActiveIdx(activeIdx === i ? null : i)}
        >
          <div className="flex items-center px-3 py-2.5 gap-3">
            {/* Left: item info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[11px] text-muted-foreground">{item.packSize}</span>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-[11px] text-muted-foreground">#{item.itemNumber}</span>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-[11px] px-1 py-px rounded bg-accent/50 text-accent-foreground font-medium">{item.currentPan} pan</span>
              </div>
            </div>

            {/* Right: quick count inputs */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="text-center">
                <input
                  type="text"
                  inputMode="numeric"
                  defaultValue={item.cases}
                  className="w-12 h-9 text-center text-base font-bold text-foreground bg-muted rounded-lg border border-border/50 outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[9px] text-muted-foreground mt-0.5 uppercase">Cases</p>
              </div>
              <div className="text-center">
                <input
                  type="text"
                  inputMode="numeric"
                  defaultValue={item.units}
                  className="w-12 h-9 text-center text-base font-bold text-foreground bg-muted rounded-lg border border-border/50 outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[9px] text-muted-foreground mt-0.5 uppercase">{item.unitLabel}</p>
              </div>
            </div>
          </div>

          {/* Expanded detail row */}
          {activeIdx === i && (
            <div className="px-3 pb-2.5 flex items-center gap-2 flex-wrap">
              {item.panSizes.map(pan => (
                <button
                  key={pan}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    pan === item.currentPan
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {pan}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">${item.costPerCase}/case</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────
// OPTION B — MarginEdge-Inspired: Card Stack
// Full-width card per item, swipe-friendly, bold quantities
// ─────────────────────────────────────────────
const OptionB = () => (
  <div className="space-y-3">
    {mockItems.map((item, i) => (
      <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
        {/* Top bar with category color */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{item.category}</span>
          </div>
          <span className="text-[11px] text-muted-foreground">{item.storageLocation}</span>
        </div>

        {/* Item name + pack */}
        <div className="px-4 pt-3 pb-2">
          <p className="font-semibold text-sm text-foreground">{item.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{item.packSize} · #{item.itemNumber} · ${item.costPerCase}/case</p>
        </div>

        {/* Pan type selector */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-1.5">
            <Scale className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground mr-1">Pan:</span>
            {item.panSizes.map(pan => (
              <button
                key={pan}
                className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                  pan === item.currentPan
                    ? 'bg-primary/15 text-primary font-semibold border border-primary/30'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {pan}
              </button>
            ))}
          </div>
        </div>

        {/* Count area - big touch targets */}
        <div className="grid grid-cols-2 gap-px bg-border">
          <div className="bg-card p-3 flex flex-col items-center">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Cases</span>
            <div className="flex items-center gap-1">
              <button className="h-11 w-11 flex items-center justify-center rounded-xl bg-muted text-muted-foreground active:scale-95 transition-all">
                <Minus className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <input
                type="text"
                inputMode="numeric"
                defaultValue={item.cases}
                className="w-14 h-11 text-center text-2xl font-bold text-foreground bg-transparent outline-none tabular-nums"
              />
              <button className="h-11 w-11 flex items-center justify-center rounded-xl bg-primary text-primary-foreground active:scale-95 transition-all">
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
          <div className="bg-card p-3 flex flex-col items-center">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">{item.unitLabel}</span>
            <div className="flex items-center gap-1">
              <button className="h-11 w-11 flex items-center justify-center rounded-xl bg-muted text-muted-foreground active:scale-95 transition-all">
                <Minus className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <input
                type="text"
                inputMode="numeric"
                defaultValue={item.units}
                className="w-14 h-11 text-center text-2xl font-bold text-foreground bg-transparent outline-none tabular-nums"
              />
              <button className="h-11 w-11 flex items-center justify-center rounded-xl bg-primary text-primary-foreground active:scale-95 transition-all">
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────
// OPTION C — Sabertooth-Inspired: Focus Mode
// One item at a time, full-screen card, swipe to advance
// ─────────────────────────────────────────────
const OptionC = () => {
  const [idx, setIdx] = useState(0);
  const item = mockItems[idx];

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${((idx + 1) / mockItems.length) * 100}%` }} />
      </div>

      {/* Navigation header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <button
          onClick={() => setIdx(Math.max(0, idx - 1))}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={idx === 0}
        >
          ← Prev
        </button>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">{idx + 1} / {mockItems.length}</span>
        <button
          onClick={() => setIdx(Math.min(mockItems.length - 1, idx + 1))}
          className="text-xs text-primary font-semibold hover:text-primary/80 disabled:opacity-30"
          disabled={idx === mockItems.length - 1}
        >
          Next →
        </button>
      </div>

      {/* Item detail */}
      <div className="px-4 pt-4 pb-3 text-center">
        <p className="text-[11px] font-medium text-primary uppercase tracking-wider">{item.category} · {item.storageLocation}</p>
        <p className="font-bold text-lg text-foreground mt-1">{item.name}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{item.packSize} · #{item.itemNumber}</p>
      </div>

      {/* Pan type */}
      <div className="flex items-center justify-center gap-2 px-4 pb-3">
        <span className="text-[11px] text-muted-foreground">Container:</span>
        <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
          {item.panSizes.map(pan => (
            <button
              key={pan}
              className={`text-[11px] px-3 py-1.5 rounded-md font-medium transition-all ${
                pan === item.currentPan
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {pan}
            </button>
          ))}
        </div>
      </div>

      {/* Big count inputs */}
      <div className="bg-muted/30 px-4 py-5">
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Cases</span>
            <div className="flex items-center gap-3">
              <button className="h-12 w-12 flex items-center justify-center rounded-2xl bg-muted text-muted-foreground active:scale-90 transition-all border border-border">
                <Minus className="h-5 w-5" strokeWidth={2} />
              </button>
              <input
                type="text"
                inputMode="numeric"
                defaultValue={item.cases}
                className="w-16 text-center text-3xl font-bold text-foreground bg-transparent outline-none tabular-nums"
              />
              <button className="h-12 w-12 flex items-center justify-center rounded-2xl bg-primary text-primary-foreground active:scale-90 transition-all">
                <Plus className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground mt-1.5">${item.costPerCase}/case</span>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">{item.unitLabel}</span>
            <div className="flex items-center gap-3">
              <button className="h-12 w-12 flex items-center justify-center rounded-2xl bg-muted text-muted-foreground active:scale-90 transition-all border border-border">
                <Minus className="h-5 w-5" strokeWidth={2} />
              </button>
              <input
                type="text"
                inputMode="numeric"
                defaultValue={item.units}
                className="w-16 text-center text-3xl font-bold text-foreground bg-transparent outline-none tabular-nums"
              />
              <button className="h-12 w-12 flex items-center justify-center rounded-2xl bg-primary text-primary-foreground active:scale-90 transition-all">
                <Plus className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground mt-1.5">{item.packSize}/unit</span>
          </div>
        </div>
      </div>

      {/* Confirm row */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
        <p className="text-sm text-muted-foreground">Total: <span className="font-semibold text-foreground">${item.totalCost.toFixed(2)}</span></p>
        <button
          onClick={() => setIdx(Math.min(mockItems.length - 1, idx + 1))}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 transition-all"
        >
          <Check className="h-4 w-4" /> Confirm
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// OPTION D — Hybrid Grid: Compact Tile Layout
// 2-column grid for rapid entry, pan badge inline
// ─────────────────────────────────────────────
const OptionD = () => (
  <div className="space-y-2">
    {/* Storage location header */}
    <div className="flex items-center justify-between px-1">
      <div className="flex items-center gap-2">
        <Package className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold text-primary uppercase tracking-wider">Walk-in Cooler</span>
      </div>
      <span className="text-[10px] text-muted-foreground">3 items</span>
    </div>

    <div className="grid grid-cols-2 gap-2">
      {mockItems.map((item, i) => (
        <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Item header */}
          <div className="px-3 pt-2.5 pb-1.5">
            <p className="text-xs font-semibold text-foreground line-clamp-2 leading-tight">{item.name}</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-muted-foreground">{item.packSize}</span>
              <span className="text-[10px] px-1.5 py-px rounded bg-primary/10 text-primary font-medium">{item.currentPan}</span>
            </div>
          </div>

          {/* Stacked inputs */}
          <div className="px-3 pb-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase w-10">Case</span>
              <div className="flex items-center bg-muted rounded-lg overflow-hidden flex-1 ml-1">
                <button className="h-8 w-8 flex items-center justify-center text-muted-foreground active:scale-95 transition-all flex-shrink-0">
                  <Minus className="h-3 w-3" strokeWidth={2.5} />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  defaultValue={item.cases}
                  className="flex-1 text-center text-sm font-bold text-foreground bg-transparent outline-none tabular-nums w-0"
                />
                <button className="h-8 w-8 flex items-center justify-center text-primary active:scale-95 transition-all flex-shrink-0">
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase w-10">{item.unitLabel.slice(0, 4)}</span>
              <div className="flex items-center bg-muted rounded-lg overflow-hidden flex-1 ml-1">
                <button className="h-8 w-8 flex items-center justify-center text-muted-foreground active:scale-95 transition-all flex-shrink-0">
                  <Minus className="h-3 w-3" strokeWidth={2.5} />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  defaultValue={item.units}
                  className="flex-1 text-center text-sm font-bold text-foreground bg-transparent outline-none tabular-nums w-0"
                />
                <button className="h-8 w-8 flex items-center justify-center text-primary active:scale-95 transition-all flex-shrink-0">
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────
// OPTION E — Checklist-Style: Swipe to Complete
// Each row is a task-like item, mark done when counted
// ─────────────────────────────────────────────
const OptionE = () => {
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Header with progress */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="text-sm font-semibold text-foreground">Walk-in Cooler</p>
          <p className="text-[11px] text-muted-foreground">{completed.size}/{mockItems.length} counted</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${(completed.size / mockItems.length) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-semibold text-primary tabular-nums">{Math.round((completed.size / mockItems.length) * 100)}%</span>
        </div>
      </div>

      {mockItems.map((item, i) => {
        const isDone = completed.has(i);
        return (
          <div key={i} className={`border-b border-border last:border-b-0 ${isDone ? 'bg-muted/30' : ''}`}>
            {/* Main row */}
            <div className="flex items-center px-4 py-3 gap-3">
              {/* Checkbox */}
              <button
                onClick={() => {
                  const next = new Set(completed);
                  isDone ? next.delete(i) : next.add(i);
                  setCompleted(next);
                }}
                className={`h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
                  isDone
                    ? 'bg-primary border-primary'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                {isDone && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
              </button>

              {/* Item info */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {item.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] text-muted-foreground">{item.packSize}</span>
                  <span className="text-[10px] px-1.5 py-px rounded-full bg-accent text-accent-foreground font-medium">{item.currentPan} pan</span>
                  <span className="text-[10px] text-muted-foreground">· {item.unitLabel}</span>
                </div>
              </div>

              {/* Quick count */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="text-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    defaultValue={item.cases}
                    className="w-10 h-8 text-center text-sm font-bold text-foreground bg-muted rounded-md border border-border/50 outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <p className="text-[8px] text-muted-foreground mt-px uppercase">CS</p>
                </div>
                <div className="text-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    defaultValue={item.units}
                    className="w-10 h-8 text-center text-sm font-bold text-foreground bg-muted rounded-md border border-border/50 outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <p className="text-[8px] text-muted-foreground mt-px uppercase">EA</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Bottom action */}
      <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Tap ✓ after counting each item</span>
        <button className="text-xs font-semibold text-primary">Mark All Done</button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// MAIN PREVIEW PAGE
// ─────────────────────────────────────────────
const InventoryCountUIPreview = () => {
  return (
    <div className="min-h-screen bg-background p-4 max-w-md mx-auto space-y-8 pb-20">
      <div>
        <h1 className="text-xl font-bold text-foreground">Counting Page UI Options</h1>
        <p className="text-sm text-muted-foreground mt-1">Mobile-first designs inspired by R365, Sabertooth, MarginEdge</p>
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">A — R365 List Scanner</h2>
        <p className="text-[11px] text-muted-foreground -mt-1">Dense list, inline inputs, tap to expand pan selector</p>
        <OptionA />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">B — MarginEdge Card Stack</h2>
        <p className="text-[11px] text-muted-foreground -mt-1">Full-width cards with big touch targets & pan pills</p>
        <OptionB />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">C — Sabertooth Focus Mode</h2>
        <p className="text-[11px] text-muted-foreground -mt-1">One item at a time, confirm-to-advance, segmented pan toggle</p>
        <OptionC />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">D — Compact Tile Grid</h2>
        <p className="text-[11px] text-muted-foreground -mt-1">2-column tiles for rapid entry with inline pan badges</p>
        <OptionD />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">E — Checklist Counter</h2>
        <p className="text-[11px] text-muted-foreground -mt-1">Task-list style with progress tracking & mark-done flow</p>
        <OptionE />
      </div>
    </div>
  );
};

export default InventoryCountUIPreview;

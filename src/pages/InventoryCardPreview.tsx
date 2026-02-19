import { Minus, Plus } from "lucide-react";

const mockItem = {
  name: "PEPPERS GREEN JULIENNE 5#",
  packSize: "5#",
  itemNumber: "48291",
  costPerCase: 24.30,
  cases: 3,
  units: 2,
  totalCost: 72.90,
  totalUnits: 17,
};

// Option A: Clean Minimal — flat, no header bg, subtle dividers
const CardOptionA = () => (
  <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
    <div className="p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-semibold text-sm text-foreground">{mockItem.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{mockItem.packSize} · #{mockItem.itemNumber} · ${mockItem.costPerCase}/case</p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-foreground">${mockItem.totalCost.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">{mockItem.totalUnits} units</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <CounterControl label="Cases" value={mockItem.cases} />
        <CounterControl label="Units" value={mockItem.units} />
      </div>
    </div>
  </div>
);

// Option B: iOS Settings style — grouped with inset rows
const CardOptionB = () => (
  <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm text-foreground truncate">{mockItem.name}</p>
        <p className="text-xs text-muted-foreground">{mockItem.packSize} · ${mockItem.costPerCase}/case</p>
      </div>
      <div className="text-right ml-3 flex-shrink-0">
        <p className="font-semibold text-foreground">${mockItem.totalCost.toFixed(2)}</p>
        <p className="text-[11px] text-muted-foreground">{mockItem.totalUnits} units</p>
      </div>
    </div>
    <div className="grid grid-cols-2 divide-x divide-border">
      <div className="p-3 flex flex-col items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Cases</span>
        <StepperControl value={mockItem.cases} />
      </div>
      <div className="p-3 flex flex-col items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Units</span>
        <StepperControl value={mockItem.units} />
      </div>
    </div>
  </div>
);

// Option C: Compact inline — stepper integrated into a single row
const CardOptionC = () => (
  <div className="bg-card rounded-xl shadow-sm border border-border p-4">
    <div className="flex items-center justify-between mb-1">
      <p className="font-semibold text-sm text-foreground truncate flex-1">{mockItem.name}</p>
      <p className="font-semibold text-foreground ml-2">${mockItem.totalCost.toFixed(2)}</p>
    </div>
    <p className="text-xs text-muted-foreground mb-3">{mockItem.packSize} · ${mockItem.costPerCase}/case · {mockItem.totalUnits} units</p>
    <div className="flex items-center gap-3">
      <div className="flex-1 flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-10">Cases</span>
        <InlineStepper value={mockItem.cases} />
      </div>
      <div className="w-px h-8 bg-border" />
      <div className="flex-1 flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-10">Units</span>
        <InlineStepper value={mockItem.units} />
      </div>
    </div>
  </div>
);

// Option D: Apple Health inspired — bold value, subtle controls
const CardOptionD = () => (
  <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
    <div className="px-4 pt-4 pb-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-primary uppercase tracking-wider">{mockItem.packSize} · #{mockItem.itemNumber}</p>
          <p className="font-semibold text-foreground mt-0.5">{mockItem.name}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-foreground tracking-tight">${mockItem.totalCost.toFixed(2)}</p>
        </div>
      </div>
    </div>
    <div className="bg-muted/50 px-4 py-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground font-medium">Cases</span>
            <span className="text-[11px] text-muted-foreground">@ ${mockItem.costPerCase}</span>
          </div>
          <SegmentedStepper value={mockItem.cases} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground font-medium">Units</span>
            <span className="text-[11px] text-muted-foreground">{mockItem.totalUnits} total</span>
          </div>
          <SegmentedStepper value={mockItem.units} />
        </div>
      </div>
    </div>
  </div>
);

// Option E: Pill stepper — ultra-clean with pill-shaped controls
const CardOptionE = () => (
  <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
    <div className="flex items-start justify-between bg-primary px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm text-primary-foreground">{mockItem.name}</p>
        <p className="text-xs text-primary-foreground/70 mt-0.5">{mockItem.packSize} · ${mockItem.costPerCase}/case</p>
      </div>
      <div className="text-right flex-shrink-0 ml-3">
        <p className="text-2xl font-bold text-primary-foreground">${mockItem.totalCost.toFixed(2)}</p>
        <p className="text-[11px] text-primary-foreground/70">{mockItem.totalUnits} units</p>
      </div>
    </div>
    <div className="flex items-center gap-3 p-4">
      <PillStepper label="Cases" value={mockItem.cases} />
      <PillStepper label="Units" value={mockItem.units} />
    </div>
  </div>
);

// Shared counter components

const CounterControl = ({ label, value }: { label: string; value: number }) => (
  <div className="flex flex-col items-center gap-1.5">
    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
    <div className="flex items-center gap-2">
      <button className="h-10 w-10 flex items-center justify-center rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 active:scale-95 transition-all">
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="w-12 text-center text-xl font-bold text-foreground tabular-nums">{value}</span>
      <button className="h-10 w-10 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all">
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  </div>
);

const StepperControl = ({ value }: { value: number }) => (
  <div className="flex items-center gap-1.5">
    <button className="h-10 w-10 flex items-center justify-center rounded-lg bg-muted text-muted-foreground active:scale-95 transition-all">
      <Minus className="h-4 w-4" strokeWidth={2} />
    </button>
    <span className="w-14 text-center text-2xl font-bold text-foreground tabular-nums">{value}</span>
    <button className="h-10 w-10 flex items-center justify-center rounded-lg bg-primary text-primary-foreground active:scale-95 transition-all">
      <Plus className="h-4 w-4" strokeWidth={2} />
    </button>
  </div>
);

const InlineStepper = ({ value }: { value: number }) => (
  <div className="flex items-center bg-muted rounded-lg overflow-hidden flex-1">
    <button className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:bg-muted/80 active:scale-95 transition-all flex-shrink-0">
      <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
    <span className="flex-1 text-center text-lg font-bold text-foreground tabular-nums">{value}</span>
    <button className="h-9 w-9 flex items-center justify-center text-primary hover:bg-primary/10 active:scale-95 transition-all flex-shrink-0">
      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  </div>
);

const SegmentedStepper = ({ value }: { value: number }) => (
  <div className="flex items-center bg-background border border-border rounded-lg overflow-hidden">
    <button className="h-11 w-11 flex items-center justify-center text-muted-foreground hover:bg-muted active:scale-95 transition-all border-r border-border">
      <Minus className="h-4 w-4" strokeWidth={2} />
    </button>
    <span className="flex-1 text-center text-xl font-bold text-foreground tabular-nums">{value}</span>
    <button className="h-11 w-11 flex items-center justify-center text-primary hover:bg-primary/10 active:scale-95 transition-all border-l border-border">
      <Plus className="h-4 w-4" strokeWidth={2} />
    </button>
  </div>
);

const PillStepper = ({ label, value }: { label: string; value: number }) => (
  <div className="flex-1">
    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{label}</span>
    <div className="flex items-center bg-muted/60 rounded-full overflow-hidden border border-border/50">
      <button className="h-11 w-11 flex items-center justify-center bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95 transition-all rounded-full flex-shrink-0">
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={value} className="flex-1 text-center text-xl font-bold text-foreground tabular-nums bg-transparent border-none outline-none w-0" />
      <button className="h-11 w-11 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all rounded-full flex-shrink-0">
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  </div>
);

const InventoryCardPreview = () => {
  return (
    <div className="min-h-screen bg-background p-4 max-w-md mx-auto space-y-6">
      <h1 className="text-xl font-bold text-foreground">Inventory Card Options</h1>
      <p className="text-sm text-muted-foreground -mt-4">Apple-inspired designs for counting cards</p>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">A — Clean Minimal</h2>
        <CardOptionA />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">B — iOS Settings</h2>
        <CardOptionB />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">C — Compact Inline</h2>
        <CardOptionC />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">D — Apple Health</h2>
        <CardOptionD />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">E — Pill Stepper</h2>
        <CardOptionE />
      </div>
    </div>
  );
};

export default InventoryCardPreview;

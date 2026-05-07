import { useMemo, useState } from "react";
import { Plus, X, Info, RotateCcw, Calculator } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface CashCountToolProps {
  drawerBank: number;
}

interface Denom {
  key: string;
  label: string;
  value: number; // dollar value of one
}

const BILLS: Denom[] = [
  { key: "b100", label: "$100", value: 100 },
  { key: "b50", label: "$50", value: 50 },
  { key: "b20", label: "$20", value: 20 },
  { key: "b10", label: "$10", value: 10 },
  { key: "b5", label: "$5", value: 5 },
  { key: "b2", label: "$2", value: 2 },
  { key: "b1", label: "$1", value: 1 },
];

const LOOSE_COINS: Denom[] = [
  { key: "cDollar", label: "$1 coin", value: 1 },
  { key: "cHalf", label: "Half ($0.50)", value: 0.5 },
  { key: "cQuarter", label: "Quarter ($0.25)", value: 0.25 },
  { key: "cDime", label: "Dime ($0.10)", value: 0.1 },
  { key: "cNickel", label: "Nickel ($0.05)", value: 0.05 },
  { key: "cPenny", label: "Penny ($0.01)", value: 0.01 },
];

const ROLLED_COINS: Denom[] = [
  { key: "rQuarter", label: "Quarter roll ($10)", value: 10 },
  { key: "rDime", label: "Dime roll ($5)", value: 5 },
  { key: "rNickel", label: "Nickel roll ($2)", value: 2 },
  { key: "rPenny", label: "Penny roll ($0.50)", value: 0.5 },
];

const ALL_DENOMS: Denom[] = [...BILLS, ...LOOSE_COINS, ...ROLLED_COINS];

type Counts = Record<string, number>;
type Drawer = { id: string; name: string; counts: Counts };

const emptyCounts = (): Counts =>
  ALL_DENOMS.reduce((acc, d) => ({ ...acc, [d.key]: 0 }), {} as Counts);

const newDrawer = (n: number): Drawer => ({
  id: crypto.randomUUID(),
  name: `Drawer ${n}`,
  counts: emptyCounts(),
});

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function DenomRow({
  denom,
  count,
  onChange,
}: {
  denom: Denom;
  count: number;
  onChange: (n: number) => void;
}) {
  const subtotal = denom.value * (count || 0);
  return (
    <div className="grid grid-cols-[1fr,90px,90px] items-center gap-2 py-1.5">
      <Label htmlFor={denom.key} className="text-sm font-medium">
        {denom.label}
      </Label>
      <Input
        id={denom.key}
        type="number"
        inputMode="numeric"
        min={0}
        value={count === 0 ? "" : count}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? 0 : Math.max(0, parseInt(v, 10) || 0));
        }}
        className="h-9 text-right tabular-nums"
        placeholder="0"
      />
      <span className="text-right text-sm tabular-nums text-muted-foreground">
        {fmtMoney(subtotal)}
      </span>
    </div>
  );
}

function DrawerPanel({
  drawer,
  drawerBank,
  onCountsChange,
  onClear,
}: {
  drawer: Drawer;
  drawerBank: number;
  onCountsChange: (counts: Counts) => void;
  onClear: () => void;
}) {
  const totals = useMemo(() => {
    const bills = BILLS.reduce(
      (s, d) => s + d.value * (drawer.counts[d.key] || 0),
      0
    );
    const loose = LOOSE_COINS.reduce(
      (s, d) => s + d.value * (drawer.counts[d.key] || 0),
      0
    );
    const rolled = ROLLED_COINS.reduce(
      (s, d) => s + d.value * (drawer.counts[d.key] || 0),
      0
    );
    const total = bills + loose + rolled;
    const variance = total - drawerBank;
    return { bills, loose, rolled, total, variance };
  }, [drawer.counts, drawerBank]);

  const setCount = (key: string, n: number) =>
    onCountsChange({ ...drawer.counts, [key]: n });

  const varianceLabel =
    Math.abs(totals.variance) < 0.005
      ? "Balanced"
      : totals.variance > 0
        ? `Over ${fmtMoney(totals.variance)}`
        : `Short ${fmtMoney(Math.abs(totals.variance))}`;

  const varianceTone =
    Math.abs(totals.variance) < 0.005
      ? "text-emerald-500"
      : totals.variance > 0
        ? "text-amber-500"
        : "text-destructive";

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-wrap items-baseline justify-between gap-3 p-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Counted total
            </p>
            <p className="text-3xl font-bold tabular-nums">
              {fmtMoney(totals.total)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Expected bank
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {fmtMoney(drawerBank)}
            </p>
            <p className={cn("text-sm font-bold tabular-nums", varianceTone)}>
              {varianceLabel}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">Bills</h3>
              <span className="text-sm tabular-nums text-muted-foreground">
                {fmtMoney(totals.bills)}
              </span>
            </div>
            <div className="divide-y divide-border/50">
              {BILLS.map((d) => (
                <DenomRow
                  key={d.key}
                  denom={d}
                  count={drawer.counts[d.key] || 0}
                  onChange={(n) => setCount(d.key, n)}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Loose coins</h3>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {fmtMoney(totals.loose)}
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {LOOSE_COINS.map((d) => (
                  <DenomRow
                    key={d.key}
                    denom={d}
                    count={drawer.counts[d.key] || 0}
                    onChange={(n) => setCount(d.key, n)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Rolled coins</h3>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {fmtMoney(totals.rolled)}
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {ROLLED_COINS.map((d) => (
                  <DenomRow
                    key={d.key}
                    denom={d}
                    count={drawer.counts[d.key] || 0}
                    onChange={(n) => setCount(d.key, n)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClear}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Clear this drawer
        </Button>
      </div>
    </div>
  );
}

export function CashCountTool({ drawerBank }: CashCountToolProps) {
  const [drawers, setDrawers] = useState<Drawer[]>([newDrawer(1)]);
  const [activeId, setActiveId] = useState<string>(() => drawers[0].id);

  const combinedTotal = useMemo(
    () =>
      drawers.reduce(
        (sum, d) =>
          sum +
          ALL_DENOMS.reduce(
            (s, denom) => s + denom.value * (d.counts[denom.key] || 0),
            0
          ),
        0
      ),
    [drawers]
  );
  const combinedExpected = drawers.length * drawerBank;
  const combinedVariance = combinedTotal - combinedExpected;

  const updateDrawer = (id: string, patch: Partial<Drawer>) =>
    setDrawers((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
    );

  const addDrawer = () => {
    const next = newDrawer(drawers.length + 1);
    setDrawers((prev) => [...prev, next]);
    setActiveId(next.id);
  };

  const removeDrawer = (id: string) => {
    if (drawers.length === 1) return;
    setDrawers((prev) => prev.filter((d) => d.id !== id));
    if (activeId === id) setActiveId(drawers[0].id);
  };

  const resetAll = () =>
    setDrawers([{ ...newDrawer(1) }]) || setActiveId((a) => a);

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              This is a calculator only.
            </span>{" "}
            Nothing is saved or recorded — use it to verify the drawer matches
            the expected bank (e.g. morning re-count for integrity). Use{" "}
            <span className="font-medium">Drawer Count</span> instead when
            you're ready to record an actual count.
          </p>
        </CardContent>
      </Card>

      <Tabs value={activeId} onValueChange={setActiveId} className="w-full">
        <div className="flex items-center gap-2">
          <TabsList className="flex-1 justify-start overflow-x-auto">
            {drawers.map((d) => (
              <TabsTrigger key={d.id} value={d.id} className="relative pr-7">
                <Calculator className="mr-1.5 h-3.5 w-3.5" />
                {d.name}
                {drawers.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDrawer(d.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        removeDrawer(d.id);
                      }
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                    aria-label={`Remove ${d.name}`}
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addDrawer}
            className="shrink-0"
          >
            <Plus className="mr-1 h-4 w-4" />
            Drawer
          </Button>
        </div>

        {drawers.map((d) => (
          <TabsContent key={d.id} value={d.id} className="mt-4">
            <DrawerPanel
              drawer={d}
              drawerBank={drawerBank}
              onCountsChange={(counts) => updateDrawer(d.id, { counts })}
              onClear={() =>
                updateDrawer(d.id, { counts: emptyCounts() })
              }
            />
          </TabsContent>
        ))}
      </Tabs>

      {drawers.length > 1 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-wrap items-baseline justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Combined ({drawers.length} drawers)
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {fmtMoney(combinedTotal)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Expected total
              </p>
              <p className="text-base font-semibold tabular-nums">
                {fmtMoney(combinedExpected)}
              </p>
              <p
                className={cn(
                  "text-sm font-bold tabular-nums",
                  Math.abs(combinedVariance) < 0.005
                    ? "text-emerald-500"
                    : combinedVariance > 0
                      ? "text-amber-500"
                      : "text-destructive"
                )}
              >
                {Math.abs(combinedVariance) < 0.005
                  ? "Balanced"
                  : combinedVariance > 0
                    ? `Over ${fmtMoney(combinedVariance)}`
                    : `Short ${fmtMoney(Math.abs(combinedVariance))}`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={resetAll}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset all drawers
        </Button>
      </div>
    </div>
  );
}

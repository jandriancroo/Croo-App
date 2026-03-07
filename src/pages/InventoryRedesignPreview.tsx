import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Package, ChevronDown, Play, Eye, Pencil, Trash2, 
  TrendingUp, TrendingDown, Truck, BarChart3, 
  ClipboardCheck, ArrowRight, CheckCircle2, Plus
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ============================================================
// DESIGN CONCEPT A — "Accordion Periods"
// Each count period is an expandable row. Tap to reveal
// COGS, variance, purchases, and count summary inline.
// ============================================================

const mockCounts = [
  {
    id: "1",
    label: "Week Ending Mar 2, 2026",
    type: "weekly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Mar 2 at 4:32 PM",
    totalItems: 87,
    countedItems: 87,
    totalCost: 12450,
    cogs: { beginning: 12100, ending: 12450, purchases: 4200, cogsTotal: 3850, salesTotal: 18200, cogsPct: 21.2 },
    purchases: [
      { vendor: "PFG", id: "#4521890", amount: 2800, date: "Feb 26" },
      { vendor: "PFG", id: "#4528901", amount: 900, date: "Feb 28" },
      { vendor: "PA", id: "#5968350", amount: 320, date: "Feb 27" },
      { vendor: "PA", id: "#5983263", amount: 180, date: "Mar 1" },
    ],
    variance: [
      { name: "Mozzarella Cheese", expected: 24, actual: 20, diff: -4, cost: -18.40 },
      { name: "Pepperoni", expected: 15, actual: 13, diff: -2, cost: -8.20 },
      { name: "Ranch Cups", expected: 50, actual: 55, diff: 5, cost: 3.75 },
    ],
  },
  {
    id: "2",
    label: "Week Ending Feb 23, 2026",
    type: "weekly",
    status: "completed",
    countedBy: "Mike R.",
    completedAt: "Feb 23 at 3:15 PM",
    totalItems: 87,
    countedItems: 85,
    totalCost: 12100,
    cogs: { beginning: 11800, ending: 12100, purchases: 3900, cogsTotal: 3600, salesTotal: 17500, cogsPct: 20.6 },
    purchases: [
      { vendor: "PFG", id: "#4510234", amount: 2600, date: "Feb 19" },
      { vendor: "PFG", id: "#4515678", amount: 850, date: "Feb 21" },
      { vendor: "PA", id: "#5950120", amount: 450, date: "Feb 20" },
    ],
    variance: [
      { name: "Chicken Wings", expected: 30, actual: 26, diff: -4, cost: -22.00 },
      { name: "Flour", expected: 8, actual: 8, diff: 0, cost: 0 },
    ],
  },
  {
    id: "3",
    label: "Week Ending Mar 9, 2026",
    type: "weekly",
    status: "in_progress",
    countedBy: "You",
    completedAt: null,
    totalItems: 87,
    countedItems: 42,
    totalCost: 0,
    cogs: null,
    purchases: [],
    variance: [],
  },
];

// ——— CONCEPT A: Accordion ———
function ConceptA() {
  const [expandedId, setExpandedId] = useState<string | null>("1");

  return (
    <div className="space-y-3">
      {/* Active Count Banner */}
      {mockCounts.find(c => c.status === "in_progress") && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <Play className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Week Ending Mar 9</p>
                <p className="text-xs text-muted-foreground">42 of 87 items counted</p>
              </div>
            </div>
            <Button size="sm">Continue</Button>
          </CardContent>
        </Card>
      )}

      {/* Period List */}
      <div className="space-y-2">
        {mockCounts.filter(c => c.status === "completed").map(count => {
          const isOpen = expandedId === count.id;
          return (
            <Card key={count.id} className="overflow-hidden">
              {/* Period Header — always visible */}
              <button
                className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(isOpen ? null : count.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{count.label}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{count.countedBy}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">${count.totalCost.toLocaleString()}</span>
                      {count.cogs && (
                        <>
                          <span className="text-xs text-muted-foreground">•</span>
                          <span className={`text-xs font-medium ${count.cogs.cogsPct > 22 ? 'text-red-500' : 'text-emerald-600'}`}>
                            {count.cogs.cogsPct}% COGS
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                </motion.div>
              </button>

              {/* Expanded Content */}
              <AnimatePresence>
                {isOpen && count.cogs && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-4 border-t border-border/50">
                      {/* COGS Summary */}
                      <div className="pt-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cost of Goods</p>
                        <div className="grid grid-cols-2 gap-2">
                          <MetricTile label="Beginning" value={`$${count.cogs.beginning.toLocaleString()}`} />
                          <MetricTile label="Ending" value={`$${count.cogs.ending.toLocaleString()}`} />
                          <MetricTile label="Purchases" value={`$${count.cogs.purchases.toLocaleString()}`} />
                          <MetricTile label="COGS" value={`$${count.cogs.cogsTotal.toLocaleString()}`} accent />
                        </div>
                        <div className="mt-2 p-2 rounded-lg bg-muted/50 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Sales: ${count.cogs.salesTotal.toLocaleString()}</span>
                          <Badge variant={count.cogs.cogsPct > 22 ? "destructive" : "default"} className="text-xs">
                            {count.cogs.cogsPct}%
                          </Badge>
                        </div>
                      </div>

                      {/* Purchases */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Purchases</p>
                        <div className="space-y-1.5">
                          {count.purchases.map((po, i) => (
                            <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/30">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px] px-1.5">{po.vendor}</Badge>
                                <span className="text-xs font-mono">{po.id}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-xs font-medium">${po.amount}</span>
                                <span className="text-xs text-muted-foreground ml-2">{po.date}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Variance Highlights */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Variance Highlights</p>
                        <div className="space-y-1.5">
                          {count.variance.filter(v => v.diff !== 0).map((v, i) => (
                            <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/30">
                              <span className="text-xs font-medium">{v.name}</span>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium ${v.diff < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                  {v.diff > 0 ? '+' : ''}{v.diff}
                                </span>
                                <span className={`text-xs ${v.cost < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                  {v.cost < 0 ? '-' : '+'}${Math.abs(v.cost).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        <Button variant="outline" size="sm" className="flex-1 text-xs">
                          <Eye className="h-3.5 w-3.5 mr-1.5" /> View Count
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 text-xs">
                          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                        </Button>
                        <Button variant="outline" size="sm" className="text-xs text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ——— CONCEPT B: Timeline Cards ———
function ConceptB() {
  const [selectedId, setSelectedId] = useState<string | null>("1");
  const selected = mockCounts.find(c => c.id === selectedId);

  return (
    <div className="space-y-4">
      {/* In-progress strip */}
      {mockCounts.find(c => c.status === "in_progress") && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/30 bg-primary/5">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Play className="h-4 w-4 text-primary" />
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary animate-pulse" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">In Progress — Week Ending Mar 9</p>
            <div className="w-full bg-muted rounded-full h-1.5 mt-1.5">
              <div className="bg-primary rounded-full h-1.5" style={{ width: '48%' }} />
            </div>
          </div>
          <Button size="sm" variant="default">Resume</Button>
        </div>
      )}

      {/* Horizontal period selector — scrollable chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
        {mockCounts.filter(c => c.status === "completed").map(count => (
          <button
            key={count.id}
            onClick={() => setSelectedId(count.id)}
            className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
              selectedId === count.id
                ? 'bg-foreground text-background border-foreground shadow-lg'
                : 'bg-muted/50 text-foreground border-transparent hover:bg-muted'
            }`}
          >
            {count.label.replace("Week Ending ", "WE ")}
          </button>
        ))}
      </div>

      {/* Selected period detail */}
      {selected && selected.cogs && (
        <motion.div
          key={selected.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          {/* Hero metrics */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 rounded-xl bg-muted/50 text-center">
              <p className="text-lg font-bold">${(selected.cogs.cogsTotal / 1000).toFixed(1)}k</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">COGS</p>
            </div>
            <div className="p-3 rounded-xl bg-muted/50 text-center">
              <p className={`text-lg font-bold ${selected.cogs.cogsPct > 22 ? 'text-red-500' : 'text-emerald-600'}`}>
                {selected.cogs.cogsPct}%
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">COGS %</p>
            </div>
            <div className="p-3 rounded-xl bg-muted/50 text-center">
              <p className="text-lg font-bold">${(selected.totalCost / 1000).toFixed(1)}k</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">On Hand</p>
            </div>
          </div>

          {/* COGS Waterfall */}
          <Card>
            <CardContent className="p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">COGS Breakdown</p>
              <div className="space-y-2">
                <WaterfallRow label="Beginning Inventory" value={selected.cogs.beginning} />
                <WaterfallRow label="+ Purchases" value={selected.cogs.purchases} positive />
                <WaterfallRow label="− Ending Inventory" value={selected.cogs.ending} negative />
                <div className="border-t border-border pt-2">
                  <WaterfallRow label="= COGS" value={selected.cogs.cogsTotal} bold />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Purchases */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Purchases</p>
                <Badge variant="secondary" className="text-[10px]">{selected.purchases.length} orders</Badge>
              </div>
              <div className="divide-y divide-border/50">
                {selected.purchases.map((po, i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold ${
                        po.vendor === 'PFG' ? 'bg-blue-500/10 text-blue-600' : 'bg-green-500/10 text-green-600'
                      }`}>
                        {po.vendor}
                      </div>
                      <div>
                        <p className="text-xs font-mono">{po.id}</p>
                        <p className="text-[10px] text-muted-foreground">{po.date}</p>
                      </div>
                    </div>
                    <p className="text-sm font-medium">${po.amount}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Variance */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Variance</p>
                <Badge variant="outline" className="text-[10px]">
                  {selected.variance.filter(v => v.diff !== 0).length} items
                </Badge>
              </div>
              <div className="divide-y divide-border/50">
                {selected.variance.filter(v => v.diff !== 0).map((v, i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      {v.diff < 0 
                        ? <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                        : <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                      }
                      <span className="text-xs font-medium">{v.name}</span>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-medium ${v.diff < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {v.diff > 0 ? '+' : ''}{v.diff} units
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {v.cost < 0 ? '-' : '+'}${Math.abs(v.cost).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1">
              <Eye className="h-4 w-4 mr-1.5" /> Full Count
            </Button>
            <Button variant="outline" size="sm" className="flex-1">
              <Pencil className="h-4 w-4 mr-1.5" /> Edit
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ——— CONCEPT C: Two-Column Split ———
function ConceptC() {
  const [selectedId, setSelectedId] = useState<string>("1");
  const selected = mockCounts.find(c => c.id === selectedId);

  return (
    <div className="space-y-3">
      {/* In-progress card */}
      {mockCounts.find(c => c.status === "in_progress") && (
        <div className="p-3 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center relative">
              <Play className="h-4 w-4 text-primary" />
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
              </span>
            </div>
            <div>
              <p className="text-sm font-bold">WE Mar 9 — In Progress</p>
              <p className="text-xs text-muted-foreground">42/87 items • Tap to resume</p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-primary" />
        </div>
      )}

      {/* Period list + inline detail (stacked on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-[240px,1fr] gap-3">
        {/* Left: Period list */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Completed Periods</p>
          {mockCounts.filter(c => c.status === "completed").map(count => (
            <button
              key={count.id}
              onClick={() => setSelectedId(count.id)}
              className={`w-full text-left p-3 rounded-xl transition-all ${
                selectedId === count.id
                  ? 'bg-primary/10 border border-primary/30 shadow-sm'
                  : 'bg-muted/30 border border-transparent hover:bg-muted/60'
              }`}
            >
              <p className="text-sm font-semibold">{count.label.replace("Week Ending ", "WE ")}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground">${count.totalCost.toLocaleString()}</span>
                {count.cogs && (
                  <Badge variant={count.cogs.cogsPct > 22 ? "destructive" : "secondary"} className="text-[10px]">
                    {count.cogs.cogsPct}%
                  </Badge>
                )}
              </div>
            </button>
          ))}
          <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-muted-foreground">
            <Plus className="h-3.5 w-3.5 mr-1" /> Start New Count
          </Button>
        </div>

        {/* Right: Detail panel */}
        {selected && selected.cogs && (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {/* Summary strip */}
            <div className="p-3 rounded-xl bg-muted/40 border border-border/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold">{selected.label}</p>
                <span className="text-xs text-muted-foreground">{selected.countedBy} • {selected.completedAt}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <MiniStat label="Begin" value={`$${(selected.cogs.beginning / 1000).toFixed(1)}k`} />
                <MiniStat label="Purchases" value={`$${(selected.cogs.purchases / 1000).toFixed(1)}k`} />
                <MiniStat label="End" value={`$${(selected.cogs.ending / 1000).toFixed(1)}k`} />
                <MiniStat label="COGS" value={`${selected.cogs.cogsPct}%`} highlight={selected.cogs.cogsPct > 22} />
              </div>
            </div>

            {/* Tabbed detail sections */}
            <Tabs defaultValue="purchases" className="w-full">
              <TabsList className="grid w-full grid-cols-3 h-9">
                <TabsTrigger value="purchases" className="text-xs">
                  <Truck className="h-3.5 w-3.5 mr-1" /> Purchases
                </TabsTrigger>
                <TabsTrigger value="variance" className="text-xs">
                  <BarChart3 className="h-3.5 w-3.5 mr-1" /> Variance
                </TabsTrigger>
                <TabsTrigger value="count" className="text-xs">
                  <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Count
                </TabsTrigger>
              </TabsList>

              <TabsContent value="purchases" className="mt-2">
                <div className="space-y-1.5">
                  {selected.purchases.map((po, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/30">
                      <div className="flex items-center gap-2">
                        <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          po.vendor === 'PFG' ? 'bg-blue-500/15 text-blue-600' : 'bg-green-500/15 text-green-600'
                        }`}>
                          {po.vendor}
                        </div>
                        <span className="text-xs font-mono">{po.id}</span>
                        <span className="text-[10px] text-muted-foreground">{po.date}</span>
                      </div>
                      <span className="text-sm font-semibold">${po.amount}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 px-1">
                    <span className="text-xs text-muted-foreground">Total</span>
                    <span className="text-sm font-bold">${selected.purchases.reduce((s, p) => s + p.amount, 0).toLocaleString()}</span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="variance" className="mt-2">
                <div className="space-y-1.5">
                  {selected.variance.filter(v => v.diff !== 0).map((v, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/30">
                      <div className="flex items-center gap-2">
                        {v.diff < 0 
                          ? <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                          : <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                        }
                        <span className="text-xs font-medium">{v.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-mono ${v.diff < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                          {v.diff > 0 ? '+' : ''}{v.diff}
                        </span>
                        <span className={`text-xs font-medium ${v.cost < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                          {v.cost < 0 ? '-' : '+'}${Math.abs(v.cost).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="count" className="mt-2">
                <div className="p-4 rounded-lg bg-muted/30 border border-border/30 text-center">
                  <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium">{selected.countedItems}/{selected.totalItems} items counted</p>
                  <p className="text-xs text-muted-foreground mt-1">On-hand value: ${selected.totalCost.toLocaleString()}</p>
                  <div className="flex gap-2 mt-3 justify-center">
                    <Button variant="outline" size="sm" className="text-xs">
                      <Eye className="h-3.5 w-3.5 mr-1" /> View Details
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs">
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Count
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ——— Shared UI Components ———
function MetricTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`p-2.5 rounded-lg ${accent ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50'}`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-bold mt-0.5 ${accent ? 'text-primary' : ''}`}>{value}</p>
    </div>
  );
}

function WaterfallRow({ label, value, positive, negative, bold }: { label: string; value: number; positive?: boolean; negative?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${bold ? 'font-bold' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-bold' : 'font-medium'} ${positive ? 'text-emerald-600' : negative ? 'text-red-500' : ''}`}>
        ${value.toLocaleString()}
      </span>
    </div>
  );
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-sm font-bold ${highlight ? 'text-red-500' : ''}`}>{value}</p>
      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
    </div>
  );
}

// ——— Main Preview Page ———
export default function InventoryRedesignPreview() {
  const [concept, setConcept] = useState<"A" | "B" | "C">("A");

  return (
    <Layout>
      <div className="space-y-4 max-w-2xl mx-auto">
        <div>
          <h1 className="text-xl font-bold">Inventory Redesign Preview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Each count period contains its COGS, purchases, and variance inline — no screen-jumping.
          </p>
        </div>

        {/* Concept Selector */}
        <div className="flex gap-2">
          {(["A", "B", "C"] as const).map(c => (
            <button
              key={c}
              onClick={() => setConcept(c)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                concept === c
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-muted/50 border-transparent hover:bg-muted text-foreground'
              }`}
            >
              {c === "A" && "Accordion"}
              {c === "B" && "Timeline Cards"}
              {c === "C" && "Split Panel"}
            </button>
          ))}
        </div>

        {/* Concept descriptions */}
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
          {concept === "A" && (
            <p className="text-xs text-muted-foreground">
              <strong>Accordion:</strong> Each completed period is a collapsible row. Tap to expand and see COGS, purchases, and variance inline. Compact when closed, rich when open.
            </p>
          )}
          {concept === "B" && (
            <p className="text-xs text-muted-foreground">
              <strong>Timeline Cards:</strong> Horizontal period chips at the top. Select one to see its full data below as stacked cards. Feels like swiping through snapshots.
            </p>
          )}
          {concept === "C" && (
            <p className="text-xs text-muted-foreground">
              <strong>Split Panel:</strong> Period list on the left, detail panel on the right (stacked on mobile). Tabbed sub-sections for Purchases, Variance, and Count detail.
            </p>
          )}
        </div>

        {/* Render selected concept */}
        <div className="pb-20">
          {concept === "A" && <ConceptA />}
          {concept === "B" && <ConceptB />}
          {concept === "C" && <ConceptC />}
        </div>
      </div>
    </Layout>
  );
}

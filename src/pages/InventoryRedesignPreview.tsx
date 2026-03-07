import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Package, Play, Eye, Pencil,
  TrendingUp, TrendingDown, Truck, BarChart3, 
  ClipboardCheck, ArrowRight, Plus
} from "lucide-react";
import { motion } from "framer-motion";

const mockCounts = [
  {
    id: "1",
    label: "Week Ending Mar 2, 2026",
    shortLabel: "WE Mar 2",
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
    shortLabel: "WE Feb 23",
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
    shortLabel: "WE Mar 9",
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

export default function InventoryRedesignPreview() {
  const [selectedId, setSelectedId] = useState<string>("1");
  const selected = mockCounts.find(c => c.id === selectedId);
  const completedCounts = mockCounts.filter(c => c.status === "completed");
  const inProgress = mockCounts.find(c => c.status === "in_progress");

  return (
    <Layout>
      <div className="space-y-5 max-w-3xl mx-auto">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Count periods with COGS, purchases &amp; variance — all in one place.
          </p>
        </div>

        {/* In-progress banner */}
        {inProgress && (
          <Card className="border-primary/30 bg-primary/5 overflow-hidden">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center relative flex-shrink-0">
                  <Play className="h-5 w-5 text-primary" />
                  <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                  </span>
                </div>
                <div>
                  <p className="text-base font-bold">{inProgress.shortLabel} — In Progress</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm text-muted-foreground">{inProgress.countedItems} of {inProgress.totalItems} items</span>
                    <div className="w-24 bg-muted rounded-full h-2">
                      <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${Math.round((inProgress.countedItems / inProgress.totalItems) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
              <Button size="sm" className="flex-shrink-0">
                Resume <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Main layout: period list + detail */}
        <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4">
          
          {/* Left: Period selector */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 pb-1">
              Completed Periods
            </p>
            {completedCounts.map(count => (
              <button
                key={count.id}
                onClick={() => setSelectedId(count.id)}
                className={`w-full text-left p-4 rounded-2xl transition-all ${
                  selectedId === count.id
                    ? 'bg-primary/8 border-2 border-primary/30 shadow-sm'
                    : 'bg-card border-2 border-transparent hover:bg-muted/60'
                }`}
              >
                <p className="text-sm font-bold">{count.shortLabel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{count.label}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-sm font-semibold">${count.totalCost.toLocaleString()}</span>
                  {count.cogs && (
                    <Badge 
                      variant={count.cogs.cogsPct > 22 ? "destructive" : "secondary"} 
                      className="text-xs px-2"
                    >
                      {count.cogs.cogsPct}% COGS
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{count.countedBy} • {count.completedAt}</p>
              </button>
            ))}
            <Button variant="ghost" size="sm" className="w-full mt-1 text-sm text-muted-foreground">
              <Plus className="h-4 w-4 mr-1.5" /> Start New Count
            </Button>
          </div>

          {/* Right: Detail panel */}
          {selected && selected.cogs && (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-4"
            >
              {/* Summary header */}
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-lg font-bold">{selected.label}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {selected.countedBy} • {selected.completedAt}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <SummaryMetric label="Beginning" value={`$${selected.cogs.beginning.toLocaleString()}`} />
                    <SummaryMetric label="Purchases" value={`$${selected.cogs.purchases.toLocaleString()}`} />
                    <SummaryMetric label="Ending" value={`$${selected.cogs.ending.toLocaleString()}`} />
                    <SummaryMetric 
                      label="COGS %" 
                      value={`${selected.cogs.cogsPct}%`} 
                      highlight={selected.cogs.cogsPct > 22}
                    />
                  </div>
                  {/* COGS formula */}
                  <div className="mt-4 p-3 rounded-xl bg-muted/40 space-y-1.5">
                    <FormulaRow label="Beginning Inventory" value={selected.cogs.beginning} />
                    <FormulaRow label="+ Purchases" value={selected.cogs.purchases} />
                    <FormulaRow label="− Ending Inventory" value={selected.cogs.ending} />
                    <div className="border-t border-border/60 pt-1.5 mt-1.5">
                      <FormulaRow label="= Cost of Goods Sold" value={selected.cogs.cogsTotal} bold />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground">Net Sales</span>
                      <span className="text-sm font-medium">${selected.cogs.salesTotal.toLocaleString()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tabbed sections */}
              <Tabs defaultValue="purchases" className="w-full">
                <TabsList className="grid w-full grid-cols-3 h-11">
                  <TabsTrigger value="purchases" className="text-sm gap-1.5">
                    <Truck className="h-4 w-4" /> Purchases
                  </TabsTrigger>
                  <TabsTrigger value="variance" className="text-sm gap-1.5">
                    <BarChart3 className="h-4 w-4" /> Variance
                  </TabsTrigger>
                  <TabsTrigger value="count" className="text-sm gap-1.5">
                    <ClipboardCheck className="h-4 w-4" /> Count
                  </TabsTrigger>
                </TabsList>

                {/* Purchases Tab */}
                <TabsContent value="purchases" className="mt-3">
                  <Card>
                    <CardContent className="p-4 space-y-0 divide-y divide-border/40">
                      {selected.purchases.map((po, i) => (
                        <div key={i} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold ${
                              po.vendor === 'PFG' 
                                ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400' 
                                : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400'
                            }`}>
                              {po.vendor}
                            </div>
                            <div>
                              <p className="text-sm font-medium font-mono">{po.id}</p>
                              <p className="text-xs text-muted-foreground">{po.date}</p>
                            </div>
                          </div>
                          <p className="text-base font-semibold">${po.amount.toLocaleString()}</p>
                        </div>
                      ))}
                      {/* Total row */}
                      <div className="flex items-center justify-between pt-3">
                        <span className="text-sm font-medium text-muted-foreground">Total Purchases</span>
                        <span className="text-base font-bold">
                          ${selected.purchases.reduce((s, p) => s + p.amount, 0).toLocaleString()}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Variance Tab */}
                <TabsContent value="variance" className="mt-3">
                  <Card>
                    <CardContent className="p-4 space-y-0 divide-y divide-border/40">
                      {selected.variance.filter(v => v.diff !== 0).length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">No variance items for this period.</p>
                      ) : (
                        selected.variance.filter(v => v.diff !== 0).map((v, i) => (
                          <div key={i} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                                v.diff < 0 
                                  ? 'bg-destructive/10' 
                                  : 'bg-emerald-500/10'
                              }`}>
                                {v.diff < 0 
                                  ? <TrendingDown className="h-4 w-4 text-destructive" />
                                  : <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                }
                              </div>
                              <div>
                                <p className="text-sm font-medium">{v.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  Expected {v.expected} → Actual {v.actual}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-semibold ${v.diff < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {v.diff > 0 ? '+' : ''}{v.diff} units
                              </p>
                              <p className={`text-xs ${v.cost < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {v.cost < 0 ? '−' : '+'}${Math.abs(v.cost).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Count Tab */}
                <TabsContent value="count" className="mt-3">
                  <Card>
                    <CardContent className="p-6 text-center space-y-4">
                      <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto">
                        <Package className="h-7 w-7 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-lg font-bold">{selected.countedItems} / {selected.totalItems} items</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          On-hand value: <span className="font-semibold text-foreground">${selected.totalCost.toLocaleString()}</span>
                        </p>
                      </div>
                      <div className="flex gap-3 justify-center">
                        <Button variant="outline" size="default">
                          <Eye className="h-4 w-4 mr-2" /> View Details
                        </Button>
                        <Button variant="outline" size="default">
                          <Pencil className="h-4 w-4 mr-2" /> Edit Count
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </div>
      </div>
    </Layout>
  );
}

// ——— Components ———

function SummaryMetric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-center p-2 rounded-xl bg-muted/40">
      <p className={`text-base font-bold ${highlight ? 'text-destructive' : ''}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function FormulaRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${bold ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-bold' : 'font-medium'}`}>${value.toLocaleString()}</span>
    </div>
  );
}

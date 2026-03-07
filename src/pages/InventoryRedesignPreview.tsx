import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Package, Play, Eye, Pencil,
  TrendingUp, TrendingDown, Truck, BarChart3, 
  ClipboardCheck, ArrowRight,
  Calendar, ChevronDown, Crosshair
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type SpotCheckItem = { name: string; quantity: number; lastCountQty: number; note?: string };

type SpotCheck = {
  date: string;
  time: string;
  countedBy: string;
  items: SpotCheckItem[];
  note?: string;
};

const mockCounts = [
  {
    id: "ip1",
    label: "Week Ending Mar 9, 2026",
    shortLabel: "Week Ending Mar 9",
    type: "weekly",
    status: "in_progress",
    countedBy: "You",
    completedAt: null,
    totalItems: 87, countedItems: 42, totalCost: 0,
    cogs: null,
    purchases: [],
    variance: [],
    spotChecks: [
      { date: "Mar 4", time: "2:15 PM", countedBy: "Sarah M.", items: [
        { name: "Mozzarella Cheese", quantity: 18, lastCountQty: 24 },
        { name: "Pepperoni", quantity: 13, lastCountQty: 15 },
        { name: "Chicken Wings", quantity: 28, lastCountQty: 30 },
        { name: "Ranch Cups", quantity: 48, lastCountQty: 50 },
        { name: "Flour", quantity: 8, lastCountQty: 8 },
        { name: "Dough Balls", quantity: 42, lastCountQty: 45 },
      ], note: "Checked high-usage items before midweek delivery" },
    ] as SpotCheck[],
  },
  {
    id: "w12",
    label: "Week Ending Mar 2, 2026",
    shortLabel: "Week Ending Mar 2",
    type: "weekly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Mar 2 at 4:32 PM",
    totalItems: 87, countedItems: 87, totalCost: 12450,
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
    spotChecks: [
      { date: "Feb 27", time: "3:00 PM", countedBy: "Mike R.", items: [
        { name: "Mozzarella Cheese", quantity: 22, lastCountQty: 24 },
        { name: "Pepperoni", quantity: 14, lastCountQty: 15 },
        { name: "Chicken Wings", quantity: 27, lastCountQty: 30 },
        { name: "Ranch Cups", quantity: 52, lastCountQty: 50 },
      ] },
      { date: "Mar 1", time: "1:30 PM", countedBy: "Sarah M.", items: [
        { name: "Pepperoni", quantity: 11, lastCountQty: 15 },
        { name: "Mozzarella Cheese", quantity: 19, lastCountQty: 24 },
        { name: "Chicken Wings", quantity: 24, lastCountQty: 30 },
        { name: "Flour", quantity: 7, lastCountQty: 8 },
        { name: "Ranch Cups", quantity: 54, lastCountQty: 50 },
        { name: "Dough Balls", quantity: 38, lastCountQty: 45 },
      ], note: "Pepperoni looking low before weekend" },
    ] as SpotCheck[],
  },
  {
    id: "w11",
    label: "Week Ending Feb 23, 2026",
    shortLabel: "Week Ending Feb 23",
    type: "weekly",
    status: "completed",
    countedBy: "Mike R.",
    completedAt: "Feb 23 at 3:15 PM",
    totalItems: 87, countedItems: 85, totalCost: 12100,
    cogs: { beginning: 11800, ending: 12100, purchases: 3900, cogsTotal: 3600, salesTotal: 17500, cogsPct: 20.6 },
    purchases: [
      { vendor: "PFG", id: "#4510234", amount: 2600, date: "Feb 19" },
      { vendor: "PFG", id: "#4515678", amount: 850, date: "Feb 21" },
      { vendor: "PA", id: "#5950120", amount: 450, date: "Feb 20" },
    ],
    variance: [
      { name: "Chicken Wings", expected: 30, actual: 26, diff: -4, cost: -22.00 },
    ],
    spotChecks: [
      { date: "Feb 20", time: "4:00 PM", countedBy: "Sarah M.", items: [
        { name: "Chicken Wings", quantity: 24, lastCountQty: 30 },
        { name: "Mozzarella Cheese", quantity: 20, lastCountQty: 22 },
        { name: "Pepperoni", quantity: 13, lastCountQty: 14 },
        { name: "Flour", quantity: 7, lastCountQty: 8 },
        { name: "Ranch Cups", quantity: 48, lastCountQty: 50 },
      ], note: "Wings seem to be going fast" },
    ] as SpotCheck[],
  },
  {
    id: "w10",
    label: "Week Ending Feb 16, 2026",
    shortLabel: "Week Ending Feb 16",
    type: "weekly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Feb 16 at 5:45 PM",
    totalItems: 87, countedItems: 87, totalCost: 11800,
    cogs: { beginning: 11500, ending: 11800, purchases: 3750, cogsTotal: 3450, salesTotal: 16900, cogsPct: 20.4 },
    purchases: [
      { vendor: "PFG", id: "#4498712", amount: 2500, date: "Feb 12" },
      { vendor: "PA", id: "#5938400", amount: 1250, date: "Feb 13" },
    ],
    variance: [
      { name: "Flour", expected: 8, actual: 7, diff: -1, cost: -4.20 },
      { name: "Ranch Cups", expected: 48, actual: 52, diff: 4, cost: 3.00 },
    ],
    spotChecks: [] as SpotCheck[],
  },
  {
    id: "w9",
    label: "Week Ending Feb 9, 2026",
    shortLabel: "Week Ending Feb 9",
    type: "weekly",
    status: "completed",
    countedBy: "Mike R.",
    completedAt: "Feb 9 at 4:00 PM",
    totalItems: 87, countedItems: 86, totalCost: 11500,
    cogs: { beginning: 11200, ending: 11500, purchases: 4100, cogsTotal: 3800, salesTotal: 17800, cogsPct: 21.3 },
    purchases: [
      { vendor: "PFG", id: "#4486320", amount: 2700, date: "Feb 5" },
      { vendor: "PFG", id: "#4490100", amount: 950, date: "Feb 7" },
      { vendor: "PA", id: "#5925600", amount: 450, date: "Feb 6" },
    ],
    variance: [
      { name: "Pepperoni", expected: 16, actual: 14, diff: -2, cost: -8.20 },
      { name: "Mozzarella Cheese", expected: 22, actual: 19, diff: -3, cost: -13.80 },
    ],
    spotChecks: [
      { date: "Feb 6", time: "2:45 PM", countedBy: "Sarah M.", items: [
        { name: "Mozzarella Cheese", quantity: 20, lastCountQty: 22 },
        { name: "Pepperoni", quantity: 15, lastCountQty: 16 },
        { name: "Chicken Wings", quantity: 28, lastCountQty: 30 },
      ] },
    ] as SpotCheck[],
  },
  {
    id: "w8",
    label: "Week Ending Feb 2, 2026",
    shortLabel: "Week Ending Feb 2",
    type: "weekly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Feb 2 at 3:50 PM",
    totalItems: 87, countedItems: 87, totalCost: 11200,
    cogs: { beginning: 10900, ending: 11200, purchases: 3800, cogsTotal: 3500, salesTotal: 16500, cogsPct: 21.2 },
    purchases: [
      { vendor: "PFG", id: "#4472100", amount: 2400, date: "Jan 29" },
      { vendor: "PA", id: "#5912300", amount: 1400, date: "Jan 30" },
    ],
    variance: [
      { name: "Chicken Wings", expected: 28, actual: 25, diff: -3, cost: -16.50 },
    ],
    spotChecks: [] as SpotCheck[],
  },
  {
    id: "m2",
    label: "Month Ending February 2026",
    shortLabel: "ME Feb '26",
    type: "monthly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Feb 28 at 5:10 PM",
    totalItems: 87, countedItems: 87, totalCost: 48200,
    cogs: { beginning: 11200, ending: 12100, purchases: 15800, cogsTotal: 14900, salesTotal: 72500, cogsPct: 20.6 },
    purchases: [
      { vendor: "PFG", id: "#4510234", amount: 2600, date: "Feb 5" },
      { vendor: "PFG", id: "#4515678", amount: 2850, date: "Feb 12" },
      { vendor: "PFG", id: "#4521890", amount: 2800, date: "Feb 19" },
      { vendor: "PFG", id: "#4528901", amount: 2700, date: "Feb 26" },
      { vendor: "PA", id: "#5950120", amount: 1450, date: "Feb 6" },
      { vendor: "PA", id: "#5960340", amount: 1200, date: "Feb 13" },
      { vendor: "PA", id: "#5968350", amount: 1100, date: "Feb 20" },
      { vendor: "PA", id: "#5983263", amount: 1100, date: "Feb 27" },
    ],
    variance: [
      { name: "Mozzarella Cheese", expected: 96, actual: 88, diff: -8, cost: -36.80 },
      { name: "Pepperoni", expected: 60, actual: 55, diff: -5, cost: -20.50 },
      { name: "Chicken Wings", expected: 120, actual: 112, diff: -8, cost: -44.00 },
      { name: "Ranch Cups", expected: 200, actual: 210, diff: 10, cost: 7.50 },
    ],
    spotChecks: [] as SpotCheck[],
  },
  {
    id: "w7",
    label: "Week Ending Jan 26, 2026",
    shortLabel: "Week Ending Jan 26",
    type: "weekly",
    status: "completed",
    countedBy: "Mike R.",
    completedAt: "Jan 26 at 4:20 PM",
    totalItems: 87, countedItems: 87, totalCost: 10900,
    cogs: { beginning: 10600, ending: 10900, purchases: 3600, cogsTotal: 3300, salesTotal: 15800, cogsPct: 20.9 },
    purchases: [
      { vendor: "PFG", id: "#4460200", amount: 2300, date: "Jan 22" },
      { vendor: "PA", id: "#5900100", amount: 1300, date: "Jan 23" },
    ],
    variance: [
      { name: "Flour", expected: 8, actual: 7, diff: -1, cost: -4.20 },
    ],
    spotChecks: [
      { date: "Jan 23", time: "3:30 PM", countedBy: "Mike R.", items: [
        { name: "Flour", quantity: 5, lastCountQty: 8 },
        { name: "Mozzarella Cheese", quantity: 19, lastCountQty: 22 },
        { name: "Pepperoni", quantity: 12, lastCountQty: 14 },
        { name: "Ranch Cups", quantity: 44, lastCountQty: 48 },
        { name: "Chicken Wings", quantity: 25, lastCountQty: 28 },
      ], note: "Flour dropping faster than expected" },
    ] as SpotCheck[],
  },
  {
    id: "w6",
    label: "Week Ending Jan 19, 2026",
    shortLabel: "Week Ending Jan 19",
    type: "weekly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Jan 19 at 5:00 PM",
    totalItems: 87, countedItems: 87, totalCost: 10600,
    cogs: { beginning: 10400, ending: 10600, purchases: 3500, cogsTotal: 3300, salesTotal: 15200, cogsPct: 21.7 },
    purchases: [
      { vendor: "PFG", id: "#4448900", amount: 2200, date: "Jan 15" },
      { vendor: "PFG", id: "#4452100", amount: 800, date: "Jan 17" },
      { vendor: "PA", id: "#5888400", amount: 500, date: "Jan 16" },
    ],
    variance: [
      { name: "Mozzarella Cheese", expected: 23, actual: 20, diff: -3, cost: -13.80 },
      { name: "Pepperoni", expected: 14, actual: 12, diff: -2, cost: -8.20 },
    ],
    spotChecks: [] as SpotCheck[],
  },
  {
    id: "w5",
    label: "Week Ending Jan 12, 2026",
    shortLabel: "Week Ending Jan 12",
    type: "weekly",
    status: "completed",
    countedBy: "Mike R.",
    completedAt: "Jan 12 at 3:30 PM",
    totalItems: 87, countedItems: 85, totalCost: 10400,
    cogs: { beginning: 10100, ending: 10400, purchases: 3900, cogsTotal: 3600, salesTotal: 16100, cogsPct: 22.4 },
    purchases: [
      { vendor: "PFG", id: "#4436700", amount: 2600, date: "Jan 8" },
      { vendor: "PA", id: "#5876200", amount: 1300, date: "Jan 9" },
    ],
    variance: [
      { name: "Chicken Wings", expected: 32, actual: 27, diff: -5, cost: -27.50 },
      { name: "Ranch Cups", expected: 45, actual: 49, diff: 4, cost: 3.00 },
    ],
    spotChecks: [
      { date: "Jan 9", time: "2:00 PM", countedBy: "Sarah M.", items: [
        { name: "Chicken Wings", quantity: 25, lastCountQty: 32 },
        { name: "Mozzarella Cheese", quantity: 20, lastCountQty: 23 },
        { name: "Ranch Cups", quantity: 47, lastCountQty: 45 },
        { name: "Pepperoni", quantity: 13, lastCountQty: 14 },
      ] },
    ] as SpotCheck[],
  },
  {
    id: "w4",
    label: "Week Ending Jan 5, 2026",
    shortLabel: "Week Ending Jan 5",
    type: "weekly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Jan 5 at 4:10 PM",
    totalItems: 87, countedItems: 87, totalCost: 10100,
    cogs: { beginning: 9800, ending: 10100, purchases: 3400, cogsTotal: 3100, salesTotal: 14200, cogsPct: 21.8 },
    purchases: [
      { vendor: "PFG", id: "#4424500", amount: 2100, date: "Jan 1" },
      { vendor: "PA", id: "#5864000", amount: 1300, date: "Jan 2" },
    ],
    variance: [
      { name: "Flour", expected: 7, actual: 6, diff: -1, cost: -4.20 },
    ],
    spotChecks: [] as SpotCheck[],
  },
  {
    id: "m1",
    label: "Month Ending January 2026",
    shortLabel: "ME Jan '26",
    type: "monthly",
    status: "completed",
    countedBy: "Mike R.",
    completedAt: "Jan 31 at 4:45 PM",
    totalItems: 87, countedItems: 87, totalCost: 43600,
    cogs: { beginning: 9800, ending: 10900, purchases: 14400, cogsTotal: 13300, salesTotal: 61300, cogsPct: 21.7 },
    purchases: [
      { vendor: "PFG", id: "#4424500", amount: 2100, date: "Jan 1" },
      { vendor: "PFG", id: "#4436700", amount: 2600, date: "Jan 8" },
      { vendor: "PFG", id: "#4448900", amount: 2200, date: "Jan 15" },
      { vendor: "PFG", id: "#4460200", amount: 2300, date: "Jan 22" },
      { vendor: "PA", id: "#5864000", amount: 1300, date: "Jan 2" },
      { vendor: "PA", id: "#5876200", amount: 1300, date: "Jan 9" },
      { vendor: "PA", id: "#5888400", amount: 1300, date: "Jan 16" },
      { vendor: "PA", id: "#5900100", amount: 1300, date: "Jan 23" },
    ],
    variance: [
      { name: "Chicken Wings", expected: 128, actual: 118, diff: -10, cost: -55.00 },
      { name: "Mozzarella Cheese", expected: 90, actual: 82, diff: -8, cost: -36.80 },
      { name: "Pepperoni", expected: 56, actual: 50, diff: -6, cost: -24.60 },
      { name: "Ranch Cups", expected: 180, actual: 192, diff: 12, cost: 9.00 },
      { name: "Flour", expected: 30, actual: 28, diff: -2, cost: -8.40 },
    ],
    spotChecks: [] as SpotCheck[],
  },
  {
    id: "w3",
    label: "Week Ending Dec 29, 2025",
    shortLabel: "Week Ending Dec 29",
    type: "weekly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Dec 29 at 5:20 PM",
    totalItems: 87, countedItems: 87, totalCost: 9800,
    cogs: { beginning: 9500, ending: 9800, purchases: 4500, cogsTotal: 4200, salesTotal: 19800, cogsPct: 21.2 },
    purchases: [
      { vendor: "PFG", id: "#4412300", amount: 3000, date: "Dec 25" },
      { vendor: "PA", id: "#5852000", amount: 1500, date: "Dec 26" },
    ],
    variance: [
      { name: "Mozzarella Cheese", expected: 28, actual: 24, diff: -4, cost: -18.40 },
      { name: "Pepperoni", expected: 18, actual: 16, diff: -2, cost: -8.20 },
    ],
    spotChecks: [] as SpotCheck[],
  },
  {
    id: "w2",
    label: "Week Ending Dec 22, 2025",
    shortLabel: "Week Ending Dec 22",
    type: "weekly",
    status: "completed",
    countedBy: "Mike R.",
    completedAt: "Dec 22 at 3:45 PM",
    totalItems: 87, countedItems: 86, totalCost: 9500,
    cogs: { beginning: 9200, ending: 9500, purchases: 4200, cogsTotal: 3900, salesTotal: 18500, cogsPct: 21.1 },
    purchases: [
      { vendor: "PFG", id: "#4400100", amount: 2800, date: "Dec 18" },
      { vendor: "PA", id: "#5840000", amount: 1400, date: "Dec 19" },
    ],
    variance: [
      { name: "Chicken Wings", expected: 35, actual: 30, diff: -5, cost: -27.50 },
    ],
    spotChecks: [
      { date: "Dec 19", time: "4:15 PM", countedBy: "Sarah M.", items: [
        { name: "Chicken Wings", quantity: 27, lastCountQty: 35 },
        { name: "Mozzarella Cheese", quantity: 22, lastCountQty: 24 },
        { name: "Pepperoni", quantity: 16, lastCountQty: 18 },
        { name: "Ranch Cups", quantity: 40, lastCountQty: 42 },
        { name: "Flour", quantity: 6, lastCountQty: 7 },
      ], note: "Wings going fast — holiday rush" },
    ] as SpotCheck[],
  },
  {
    id: "w1",
    label: "Week Ending Dec 15, 2025",
    shortLabel: "Week Ending Dec 15",
    type: "weekly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Dec 15 at 4:55 PM",
    totalItems: 87, countedItems: 87, totalCost: 9200,
    cogs: { beginning: 8900, ending: 9200, purchases: 3800, cogsTotal: 3500, salesTotal: 16700, cogsPct: 21.0 },
    purchases: [
      { vendor: "PFG", id: "#4388000", amount: 2400, date: "Dec 11" },
      { vendor: "PA", id: "#5828000", amount: 1400, date: "Dec 12" },
    ],
    variance: [
      { name: "Ranch Cups", expected: 42, actual: 46, diff: 4, cost: 3.00 },
      { name: "Flour", expected: 7, actual: 6, diff: -1, cost: -4.20 },
    ],
    spotChecks: [] as SpotCheck[],
  },
  {
    id: "m0",
    label: "Month Ending December 2025",
    shortLabel: "ME Dec '25",
    type: "monthly",
    status: "completed",
    countedBy: "Sarah M.",
    completedAt: "Dec 31 at 5:30 PM",
    totalItems: 87, countedItems: 87, totalCost: 41200,
    cogs: { beginning: 8900, ending: 9800, purchases: 12500, cogsTotal: 11600, salesTotal: 55000, cogsPct: 21.1 },
    purchases: [
      { vendor: "PFG", id: "#4388000", amount: 2400, date: "Dec 4" },
      { vendor: "PFG", id: "#4400100", amount: 2800, date: "Dec 11" },
      { vendor: "PFG", id: "#4412300", amount: 3000, date: "Dec 18" },
      { vendor: "PFG", id: "#4424500", amount: 2800, date: "Dec 25" },
      { vendor: "PA", id: "#5816000", amount: 1200, date: "Dec 5" },
      { vendor: "PA", id: "#5828000", amount: 1400, date: "Dec 12" },
      { vendor: "PA", id: "#5840000", amount: 1400, date: "Dec 19" },
      { vendor: "PA", id: "#5852000", amount: 1500, date: "Dec 26" },
    ],
    variance: [
      { name: "Chicken Wings", expected: 140, actual: 125, diff: -15, cost: -82.50 },
      { name: "Mozzarella Cheese", expected: 108, actual: 96, diff: -12, cost: -55.20 },
      { name: "Pepperoni", expected: 68, actual: 62, diff: -6, cost: -24.60 },
      { name: "Ranch Cups", expected: 170, actual: 182, diff: 12, cost: 9.00 },
      { name: "Flour", expected: 28, actual: 26, diff: -2, cost: -8.40 },
    ],
    spotChecks: [] as SpotCheck[],
  },
];

// ——————————————————————————————
// Daily Spot Check list (v1 — simple snapshot)
// ——————————————————————————————
function DailySpotCheckList({ checks }: { checks: SpotCheck[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(checks.length === 1 ? 0 : null);

  if (!checks.length) return (
    <div className="py-8 text-center">
      <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto mb-3">
        <Crosshair className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">No daily spot checks this period.</p>
      <p className="text-xs text-muted-foreground mt-1">Spot checks are quick snapshots of key items mid-week.</p>
    </div>
  );

  return (
    <div className="space-y-0 divide-y divide-border/40">
      {checks.map((sc, i) => (
        <div key={i} className="py-3 first:pt-0 last:pb-0">
          <button
            onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Crosshair className="h-4 w-4 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">{sc.date} · {sc.time}</p>
                <p className="text-xs text-muted-foreground">{sc.countedBy} · {sc.items.length} items checked</p>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedIdx === i ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {expandedIdx === i && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="ml-12 mt-3 space-y-0 divide-y divide-border/30">
                  {/* Header row */}
                  <div className="flex items-center justify-between pb-2">
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Item</span>
                    <div className="flex items-center gap-6">
                      <span className="text-[11px] text-muted-foreground uppercase tracking-wide w-16 text-right">Last Count</span>
                      <span className="text-[11px] text-muted-foreground uppercase tracking-wide w-16 text-right">Now</span>
                    </div>
                  </div>
                  {sc.items.map((item, j) => {
                    const delta = item.quantity - item.lastCountQty;
                    return (
                      <div key={j} className="flex items-center justify-between py-2">
                        <span className="text-sm">{item.name}</span>
                        <div className="flex items-center gap-6">
                          <span className="text-sm text-muted-foreground w-16 text-right">{item.lastCountQty}</span>
                          <span className={`text-sm font-medium w-16 text-right ${
                            delta < -3 ? 'text-destructive' : ''
                          }`}>
                            {item.quantity}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {sc.note && (
                  <div className="ml-12 mt-2 px-3 py-2 rounded-lg bg-muted/40">
                    <p className="text-xs text-muted-foreground italic">📝 {sc.note}</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

// ——————————————————————————————
// Detail panel with 4 tabs (Purchases, Variance, Count, Daily Spot Check)
// ——————————————————————————————
function DetailPanel({ selected }: { selected: typeof mockCounts[0] }) {
  if (!selected.cogs) return null;
  const spotCount = selected.spotChecks.length;
  return (
    <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="space-y-4">
      {/* Summary Card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-lg font-bold">{selected.label}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {selected.countedBy} • {selected.completedAt}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-2xl font-bold ${selected.cogs.cogsPct > 22 ? 'text-destructive' : ''}`}>{selected.cogs.cogsPct}%</p>
              <p className="text-xs text-muted-foreground">COGS</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <SummaryMetric label="Beginning" value={`$${selected.cogs.beginning.toLocaleString()}`} />
            <SummaryMetric label="Purchases" value={`$${selected.cogs.purchases.toLocaleString()}`} />
            <SummaryMetric label="Ending" value={`$${selected.cogs.ending.toLocaleString()}`} />
          </div>
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

      {/* 4-tab layout */}
      <Tabs defaultValue="purchases" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-11">
          <TabsTrigger value="purchases" className="text-xs sm:text-sm gap-1">
            <Truck className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Purchases</span><span className="sm:hidden">Orders</span>
          </TabsTrigger>
          <TabsTrigger value="variance" className="text-xs sm:text-sm gap-1">
            <BarChart3 className="h-3.5 w-3.5" /> Variance
          </TabsTrigger>
          <TabsTrigger value="count" className="text-xs sm:text-sm gap-1">
            <ClipboardCheck className="h-3.5 w-3.5" /> Count
          </TabsTrigger>
          <TabsTrigger value="spotcheck" className="text-xs sm:text-sm gap-1 relative">
            <Crosshair className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Daily Spot</span><span className="sm:hidden">Spot</span>
            {spotCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{spotCount}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Purchases */}
        <TabsContent value="purchases" className="mt-3">
          <Card>
            <CardContent className="p-4 space-y-0 divide-y divide-border/40">
              {selected.purchases.map((po, i) => (
                <div key={i} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold ${
                      po.vendor === 'PFG' ? 'bg-primary/10 text-primary' : 'bg-accent/60 text-accent-foreground'
                    }`}>{po.vendor}</div>
                    <div>
                      <p className="text-sm font-medium font-mono">{po.id}</p>
                      <p className="text-xs text-muted-foreground">{po.date}</p>
                    </div>
                  </div>
                  <p className="text-base font-semibold">${po.amount.toLocaleString()}</p>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3">
                <span className="text-sm font-medium text-muted-foreground">Total Purchases</span>
                <span className="text-base font-bold">${selected.purchases.reduce((s, p) => s + p.amount, 0).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Variance */}
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
                        v.diff < 0 ? 'bg-destructive/10' : 'bg-accent/60'
                      }`}>
                        {v.diff < 0 ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-primary" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{v.name}</p>
                        <p className="text-xs text-muted-foreground">Expected {v.expected} → Actual {v.actual}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${v.diff < 0 ? 'text-destructive' : 'text-primary'}`}>
                        {v.diff > 0 ? '+' : ''}{v.diff} units
                      </p>
                      <p className={`text-xs ${v.cost < 0 ? 'text-destructive' : 'text-primary'}`}>
                        {v.cost < 0 ? '−' : '+'}${Math.abs(v.cost).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Count */}
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
                <Button variant="outline" size="default"><Eye className="h-4 w-4 mr-2" /> View Details</Button>
                <Button variant="outline" size="default"><Pencil className="h-4 w-4 mr-2" /> Edit Count</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily Spot Check */}
        <TabsContent value="spotcheck" className="mt-3">
          <Card>
            <CardContent className="p-4">
              <DailySpotCheckList checks={selected.spotChecks} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

// ——————————————————————————————
// In-progress banner
// ——————————————————————————————
function InProgressBanner({ inProgress }: { inProgress: typeof mockCounts[0] }) {
  return (
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
  );
}

// ——————————————————————————————
// Main preview — Option C (Dropdown + Filter) with Daily Spot Check tab
// ——————————————————————————————
export default function InventoryRedesignPreview() {
  const [selectedId, setSelectedId] = useState<string>("w12");
  const [typeFilter, setTypeFilter] = useState<'all' | 'weekly' | 'monthly'>('all');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const selected = mockCounts.find(c => c.id === selectedId)!;
  const completedCounts = mockCounts.filter(c => c.status === "completed");
  const inProgress = mockCounts.find(c => c.status === "in_progress");

  const filteredCounts = typeFilter === 'all'
    ? completedCounts
    : completedCounts.filter(c => c.type === typeFilter);

  return (
    <Layout>
      <div className="space-y-5 max-w-2xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory — Period View</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Dropdown + Filter with Daily Spot Check tab
          </p>
        </div>

        {inProgress && <InProgressBanner inProgress={inProgress} />}

        {/* Type filter + dropdown */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {(['all', 'weekly', 'monthly'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all ${
                  typeFilter === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >{t}</button>
            ))}
          </div>
          <div className="relative flex-1">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl bg-card border border-border/50 hover:bg-muted/40 transition-all"
            >
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-bold">{selected.shortLabel}</span>
                {selected.type === 'monthly' && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 uppercase">Mo</Badge>
                )}
                {selected.cogs && (
                  <span className="text-xs text-muted-foreground">{selected.cogs.cogsPct}%</span>
                )}
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute z-50 top-full mt-1 left-0 right-0 bg-card border border-border/60 rounded-2xl shadow-lg overflow-hidden max-h-80 overflow-y-auto"
                >
                  {filteredCounts.map(count => (
                    <button
                      key={count.id}
                      onClick={() => { setSelectedId(count.id); setDropdownOpen(false); }}
                      className={`w-full text-left px-4 py-3 flex items-center justify-between transition-all ${
                        selectedId === count.id ? 'bg-primary/8' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{count.shortLabel}</span>
                        {count.type === 'monthly' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 uppercase">Monthly</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {count.cogs && (
                          <Badge variant={count.cogs.cogsPct > 22 ? "destructive" : "secondary"} className="text-xs px-2">
                            {count.cogs.cogsPct}%
                          </Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <DetailPanel selected={selected} />
      </div>
    </Layout>
  );
}

// ——— Shared sub-components ———

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
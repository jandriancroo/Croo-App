import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, Sparkles, Target, DollarSign, Pizza, Receipt, Users, BarChart3, Percent } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ResponsiveContainer, ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

// Mock data matching real SalesSummary shape
const MOCK_HOURLY = [
  { hour: "11:00 AM", sales: 120, projected: 150 },
  { hour: "12:00 PM", sales: 145, projected: 180 },
  { hour: "1:00 PM", sales: 210, projected: 220 },
  { hour: "2:00 PM", sales: 100, projected: 180 },
  { hour: "3:00 PM", sales: 180, projected: 200 },
  { hour: "4:00 PM", sales: 240, projected: 250 },
  { hour: "5:00 PM", sales: 620, projected: 380 },
  { hour: "6:00 PM", sales: 440, projected: 400 },
  { hour: "7:00 PM", sales: 410, projected: 380 },
  { hour: "8:00 PM", sales: 180, projected: 200 },
  { hour: "9:00 PM", sales: 150, projected: 160 },
];

const MOCK = {
  sales: 2795,
  projected: 2700,
  pace: 2850,
  pizzas: 184,
  avgTicket: 14.28,
  guests: 196,
  laborPercent: 24.3,
  laborCost: 679,
  laborHours: 48.5,
  prevDayChange: 8.2,
  paceDelta: 150,
};

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtDec = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Shared chart component (unchanged per user request)
const SalesChart = () => (
  <ResponsiveContainer width="100%" height={200}>
    <ComposedChart data={MOCK_HOURLY} barCategoryGap="10%" margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
      <XAxis dataKey="hour" className="text-xs" tick={{ fill: "hsl(var(--foreground))", fontSize: 10 }} interval="preserveStartEnd" angle={-45} textAnchor="end" height={50} axisLine={false} tickLine={false} />
      <YAxis className="text-xs" tick={{ fill: "hsl(var(--foreground))", fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={40} axisLine={false} tickLine={false} />
      <Tooltip
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const data = payload[0]?.payload;
          return (
            <div className="bg-card border border-border rounded-md p-2 shadow-lg">
              <p className="font-medium">{label}</p>
              <p className="text-muted-foreground">Projected: <span className="text-foreground">{fmt(data?.projected || 0)}</span></p>
              <p className="text-primary">Actual: <span className="font-medium">{fmt(data?.sales || 0)}</span></p>
            </div>
          );
        }}
      />
      <Legend formatter={(v) => (v === "Projected" ? "Projected" : "Actual")} wrapperStyle={{ fontSize: "12px" }} />
      <Area type="monotone" dataKey="projected" name="Projected" stroke="hsl(var(--muted-foreground))" strokeWidth={2} fill="hsl(var(--muted-foreground) / 0.15)" />
      <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
    </ComposedChart>
  </ResponsiveContainer>
);

// ============================================================================
// DESIGN 1: "Split Metric Cards" — individual stat micro-cards in a grid
// ============================================================================
const Design1 = () => (
  <Card>
    <CardContent className="pt-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 1 — Split Metric Cards</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Stat micro-cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-primary/5 border border-primary/10 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] text-muted-foreground font-medium">Sales</span>
          </div>
          <p className="text-xl font-bold text-foreground">{fmt(MOCK.sales)}</p>
          <div className="flex items-center gap-1 mt-1">
            <TrendingUp className="h-3 w-3 text-green-500" />
            <span className="text-[10px] text-green-500 font-medium">+{MOCK.prevDayChange}% vs last Thu</span>
          </div>
        </div>
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/10 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[11px] text-muted-foreground font-medium">Pace</span>
          </div>
          <p className="text-xl font-bold text-amber-500">{fmt(MOCK.pace)}</p>
          <span className="text-[10px] text-green-500 font-medium">+{fmt(MOCK.paceDelta)}</span>
        </div>
        <div className="rounded-xl bg-muted/50 border border-border p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Pizza className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground font-medium">Pizzas</span>
          </div>
          <p className="text-xl font-bold text-foreground">{MOCK.pizzas}</p>
        </div>
        <div className="rounded-xl bg-muted/50 border border-border p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground font-medium">Avg Ticket</span>
          </div>
          <p className="text-xl font-bold text-foreground">{fmtDec(MOCK.avgTicket)}</p>
        </div>
      </div>

      {/* AI Goal strip */}
      <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-primary/10 to-purple-500/10 border border-primary/20 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground block">Live AI Goal</span>
            <span className="text-sm font-bold text-primary">{fmt(MOCK.projected)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] text-muted-foreground block">Labor</span>
            <span className="text-sm font-bold text-orange-500">{MOCK.laborPercent}%</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-muted-foreground block">Hours</span>
            <span className="text-sm font-medium text-foreground">{MOCK.laborHours}h</span>
          </div>
        </div>
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 2: "Hero Number" — giant sales number, compact supporting stats
// ============================================================================
const Design2 = () => (
  <Card>
    <CardContent className="pt-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 2 — Hero Number</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Hero sales */}
      <div className="text-center py-2">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">Today's Sales</p>
        <p className="text-4xl font-extrabold text-foreground tracking-tight">{fmt(MOCK.sales)}</p>
        <div className="flex items-center justify-center gap-1 mt-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-green-500" />
          <span className="text-xs text-green-500 font-medium">+{MOCK.prevDayChange}% vs last Thu</span>
        </div>
      </div>

      {/* Compact stat pills */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {[
          { label: "Goal", value: fmt(MOCK.projected), icon: Sparkles, color: "text-primary" },
          { label: "Pace", value: fmt(MOCK.pace), icon: TrendingUp, color: "text-amber-500" },
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza, color: "text-foreground" },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt, color: "text-foreground" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 rounded-full bg-muted/60 border border-border px-3 py-1.5">
            <s.icon className={`h-3 w-3 ${s.color}`} />
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
            <span className={`text-xs font-semibold ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Labor bar */}
      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
            <Percent className="h-3 w-3 text-white" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">Live Labor</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold text-orange-500">{MOCK.laborPercent}%</span>
          <span className="text-xs text-muted-foreground">{fmt(MOCK.laborCost)}</span>
          <span className="text-xs text-muted-foreground">{MOCK.laborHours}h</span>
        </div>
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 3: "Horizontal Stat Strip" — dense horizontal row of stats, no cards
// ============================================================================
const Design3 = () => (
  <Card>
    <CardContent className="pt-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 3 — Stat Strip</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Main row — scrollable on mobile */}
      <div className="flex items-end gap-4 overflow-x-auto pb-1 scrollbar-hide">
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Sales</p>
          <p className="text-2xl font-extrabold text-foreground">{fmt(MOCK.sales)}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <TrendingUp className="h-3 w-3 text-green-500" />
            <span className="text-[10px] text-green-500">+{MOCK.prevDayChange}%</span>
          </div>
        </div>
        <div className="h-10 w-px bg-border shrink-0" />
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Goal</p>
          <p className="text-lg font-bold text-primary">{fmt(MOCK.projected)}</p>
        </div>
        <div className="h-10 w-px bg-border shrink-0" />
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Pace</p>
          <p className="text-lg font-bold text-amber-500">{fmt(MOCK.pace)}</p>
          <span className="text-[10px] text-green-500 font-medium">+{fmt(MOCK.paceDelta)}</span>
        </div>
        <div className="h-10 w-px bg-border shrink-0" />
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Pizzas</p>
          <p className="text-lg font-bold text-foreground">{MOCK.pizzas}</p>
        </div>
        <div className="h-10 w-px bg-border shrink-0" />
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Ticket</p>
          <p className="text-lg font-bold text-foreground">{fmtDec(MOCK.avgTicket)}</p>
        </div>
      </div>

      {/* Labor inline */}
      <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/40 border border-border">
        <div className="h-5 w-5 rounded-full bg-orange-500 flex items-center justify-center">
          <span className="text-[9px] font-bold text-white">%</span>
        </div>
        <span className="text-xs text-muted-foreground">Labor</span>
        <span className="text-sm font-bold text-orange-500 ml-auto">{MOCK.laborPercent}%</span>
        <span className="text-xs text-muted-foreground">{fmt(MOCK.laborCost)}</span>
        <span className="text-xs text-muted-foreground">{MOCK.laborHours}h</span>
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 4: "Stacked Rows" — clean rows with accent left borders
// ============================================================================
const Design4 = () => (
  <Card>
    <CardContent className="pt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 4 — Stacked Rows</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Sales row */}
      <div className="rounded-xl border-l-4 border-l-primary bg-primary/5 p-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Today's Sales</p>
          <p className="text-2xl font-extrabold text-foreground">{fmt(MOCK.sales)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-500 font-semibold">+{MOCK.prevDayChange}%</span>
        </div>
      </div>

      {/* Goal + Pace row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border-l-4 border-l-purple-500 bg-purple-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Sparkles className="h-3 w-3 text-purple-500" />
            <span className="text-[10px] text-muted-foreground font-medium">AI Goal</span>
          </div>
          <p className="text-lg font-bold text-primary">{fmt(MOCK.projected)}</p>
        </div>
        <div className="rounded-xl border-l-4 border-l-amber-500 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingUp className="h-3 w-3 text-amber-500" />
            <span className="text-[10px] text-muted-foreground font-medium">Pace</span>
          </div>
          <p className="text-lg font-bold text-amber-500">{fmt(MOCK.pace)}</p>
          <span className="text-[10px] text-green-500 font-medium">+{fmt(MOCK.paceDelta)}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">Pizzas</p>
          <p className="text-lg font-bold text-foreground">{MOCK.pizzas}</p>
        </div>
        <div className="rounded-xl bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">Avg Ticket</p>
          <p className="text-lg font-bold text-foreground">{fmtDec(MOCK.avgTicket)}</p>
        </div>
        <div className="rounded-xl bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">Guests</p>
          <p className="text-lg font-bold text-foreground">{MOCK.guests}</p>
        </div>
      </div>

      {/* Labor row */}
      <div className="rounded-xl border-l-4 border-l-orange-500 bg-orange-500/5 p-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Live Labor</p>
          <p className="text-xl font-bold text-orange-500">{MOCK.laborPercent}%</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Cost</p>
            <p className="text-sm font-medium">{fmt(MOCK.laborCost)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Hours</p>
            <p className="text-sm font-medium">{MOCK.laborHours}h</p>
          </div>
        </div>
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 5: "Dashboard Tiles" — Apple-style rounded tiles, tight grid
// ============================================================================
const Design5 = () => (
  <Card>
    <CardContent className="pt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 5 — Dashboard Tiles</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Hero tile */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border border-primary/15 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground font-medium">Today's Sales</span>
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{fmt(MOCK.sales)}</p>
            <div className="flex items-center gap-1 mt-1">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span className="text-[10px] text-green-500 font-medium">+{MOCK.prevDayChange}% vs last Thu</span>
            </div>
          </div>
          <div className="text-right space-y-2">
            <div>
              <p className="text-[10px] text-muted-foreground">AI Goal</p>
              <p className="text-base font-bold text-primary">{fmt(MOCK.projected)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Pace</p>
              <div className="flex items-center gap-1 justify-end">
                <p className="text-base font-bold text-amber-500">{fmt(MOCK.pace)}</p>
                <span className="text-[10px] text-green-500">↑</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Small tiles grid */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza, bg: "bg-red-500/8 border-red-500/10", iconColor: "text-red-500" },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt, bg: "bg-blue-500/8 border-blue-500/10", iconColor: "text-blue-500" },
          { label: "Guests", value: String(MOCK.guests), icon: Users, bg: "bg-green-500/8 border-green-500/10", iconColor: "text-green-500" },
          { label: "Labor", value: `${MOCK.laborPercent}%`, icon: Percent, bg: "bg-orange-500/8 border-orange-500/10", iconColor: "text-orange-500" },
        ].map((t) => (
          <div key={t.label} className={`rounded-xl ${t.bg} border p-2.5 text-center`}>
            <t.icon className={`h-4 w-4 ${t.iconColor} mx-auto mb-1`} />
            <p className="text-base font-bold text-foreground">{t.value}</p>
            <p className="text-[9px] text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Labor detail bar */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/30 border border-border">
        <span className="text-xs text-muted-foreground">Labor Detail:</span>
        <span className="text-xs font-medium text-foreground ml-auto">{fmt(MOCK.laborCost)} cost</span>
        <span className="text-[10px] text-muted-foreground">•</span>
        <span className="text-xs font-medium text-foreground">{MOCK.laborHours}h worked</span>
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

const SalesDesignPreview = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Sales Summary Designs</h1>
            <p className="text-xs text-muted-foreground">5 options — same data, chart unchanged</p>
          </div>
        </div>

        <Design1 />
        <Design2 />
        <Design3 />
        <Design4 />
        <Design5 />
      </div>
    </div>
  );
};

export default SalesDesignPreview;

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, Sparkles, DollarSign, Pizza, Receipt, Users, BarChart3, Percent } from "lucide-react";
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
// DESIGN 1: "Compact Tiles" — minimal spacing, dense information
// ============================================================================
const Design1 = () => (
  <Card>
    <CardContent className="pt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 1 — Compact Tiles</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Hero tile with rounded edges */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/12 via-primary/6 to-transparent border border-primary/12 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Today's Sales</p>
            <p className="text-2xl font-extrabold text-foreground">{fmt(MOCK.sales)}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span className="text-[9px] text-green-500 font-medium">+{MOCK.prevDayChange}%</span>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div>
              <p className="text-[9px] text-muted-foreground">Goal</p>
              <p className="text-sm font-bold text-primary">{fmt(MOCK.projected)}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground">Pace</p>
              <p className="text-sm font-bold text-amber-500">{fmt(MOCK.pace)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 3x2 grid of stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza, bg: "bg-red-500/8 border-red-500/10", iconColor: "text-red-500" },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt, bg: "bg-blue-500/8 border-blue-500/10", iconColor: "text-blue-500" },
          { label: "Guests", value: String(MOCK.guests), icon: Users, bg: "bg-green-500/8 border-green-500/10", iconColor: "text-green-500" },
          { label: "Labor %", value: `${MOCK.laborPercent}%`, icon: Percent, bg: "bg-orange-500/8 border-orange-500/10", iconColor: "text-orange-500" },
          { label: "Labor Cost", value: fmt(MOCK.laborCost), icon: DollarSign, bg: "bg-purple-500/8 border-purple-500/10", iconColor: "text-purple-500" },
          { label: "Hours", value: `${MOCK.laborHours}h`, icon: BarChart3, bg: "bg-cyan-500/8 border-cyan-500/10", iconColor: "text-cyan-500" },
        ].map((t) => (
          <div key={t.label} className={`rounded-lg ${t.bg} border p-2 text-center`}>
            <t.icon className={`h-3.5 w-3.5 ${t.iconColor} mx-auto mb-0.5`} />
            <p className="text-sm font-bold text-foreground">{t.value}</p>
            <p className="text-[8px] text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 2: "Split Hero" — left hero, right metric grid
// ============================================================================
const Design2 = () => (
  <Card>
    <CardContent className="pt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 2 — Split Hero</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Hero + Goal/Pace on right */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-primary/12 via-primary/6 to-transparent border border-primary/12 p-4 flex flex-col justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground font-medium mb-1">Today's Sales</p>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{fmt(MOCK.sales)}</p>
          </div>
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="h-3 w-3 text-green-500" />
            <span className="text-[9px] text-green-500 font-medium">+{MOCK.prevDayChange}%</span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="rounded-lg bg-gradient-to-br from-purple-500/12 via-purple-500/6 to-transparent border border-purple-500/12 p-3">
            <p className="text-[9px] text-muted-foreground mb-0.5">AI Goal</p>
            <p className="text-xl font-bold text-primary">{fmt(MOCK.projected)}</p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-amber-500/12 via-amber-500/6 to-transparent border border-amber-500/12 p-3">
            <p className="text-[9px] text-muted-foreground mb-0.5">Pace</p>
            <p className="text-xl font-bold text-amber-500">{fmt(MOCK.pace)}</p>
          </div>
        </div>
      </div>

      {/* 4-column grid */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza, bg: "bg-red-500/8 border-red-500/10", iconColor: "text-red-500" },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt, bg: "bg-blue-500/8 border-blue-500/10", iconColor: "text-blue-500" },
          { label: "Guests", value: String(MOCK.guests), icon: Users, bg: "bg-green-500/8 border-green-500/10", iconColor: "text-green-500" },
          { label: "Labor", value: `${MOCK.laborPercent}%`, icon: Percent, bg: "bg-orange-500/8 border-orange-500/10", iconColor: "text-orange-500" },
        ].map((t) => (
          <div key={t.label} className={`rounded-xl ${t.bg} border p-2.5 text-center`}>
            <t.icon className={`h-4 w-4 ${t.iconColor} mx-auto mb-1`} />
            <p className="text-sm font-bold text-foreground">{t.value}</p>
            <p className="text-[8px] text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Labor detail */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/30 border border-border">
        <span className="text-xs text-muted-foreground">Labor:</span>
        <span className="text-xs font-medium text-foreground ml-auto">{fmt(MOCK.laborCost)}</span>
        <span className="text-[10px] text-muted-foreground">•</span>
        <span className="text-xs font-medium text-foreground">{MOCK.laborHours}h</span>
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 3: "Minimal Elegant" — clean minimal aesthetic with soft colors
// ============================================================================
const Design3 = () => (
  <Card>
    <CardContent className="pt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 3 — Minimal Elegant</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Hero with soft gradient */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/8 to-transparent border border-primary/8 p-4">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground font-medium mb-1">Today's Sales</p>
              <p className="text-3xl font-extrabold text-foreground">{fmt(MOCK.sales)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground mb-1">vs Pace</p>
              <p className="text-lg font-bold text-amber-600">{fmt(MOCK.pace)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-green-600" />
            <span className="text-[9px] text-green-600 font-medium">+{MOCK.prevDayChange}% vs last week</span>
          </div>
        </div>
      </div>

      {/* 2x3 clean grid */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Goal", value: fmt(MOCK.projected), icon: Sparkles, bg: "bg-purple-500/6 border-purple-500/8", iconColor: "text-purple-600" },
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza, bg: "bg-red-500/6 border-red-500/8", iconColor: "text-red-600" },
          { label: "Avg Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt, bg: "bg-blue-500/6 border-blue-500/8", iconColor: "text-blue-600" },
          { label: "Guests", value: String(MOCK.guests), icon: Users, bg: "bg-green-500/6 border-green-500/8", iconColor: "text-green-600" },
          { label: "Labor %", value: `${MOCK.laborPercent}%`, icon: Percent, bg: "bg-orange-500/6 border-orange-500/8", iconColor: "text-orange-600" },
          { label: "Hours", value: `${MOCK.laborHours}h`, icon: BarChart3, bg: "bg-cyan-500/6 border-cyan-500/8", iconColor: "text-cyan-600" },
        ].map((t) => (
          <div key={t.label} className={`rounded-lg ${t.bg} border p-2.5 text-center`}>
            <t.icon className={`h-3.5 w-3.5 ${t.iconColor} mx-auto mb-1`} />
            <p className="text-xs font-bold text-foreground">{t.value}</p>
            <p className="text-[8px] text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Labor cost bar */}
      <div className="rounded-lg bg-muted/40 border border-border p-2.5 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-medium">Labor Cost</span>
        <span className="text-sm font-bold text-foreground">{fmt(MOCK.laborCost)}</span>
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 4: "Card Stack" — vertical stack of highlighted cards
// ============================================================================
const Design4 = () => (
  <Card>
    <CardContent className="pt-5 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Design 4 — Card Stack</h3>
        <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950">🔥 On Fire</Badge>
      </div>

      {/* Primary card - Sales */}
      <div className="rounded-xl bg-gradient-to-br from-primary/12 via-primary/6 to-transparent border border-primary/12 p-3.5">
        <p className="text-[9px] text-muted-foreground font-medium mb-1">TODAY'S SALES</p>
        <div className="flex items-end justify-between">
          <p className="text-3xl font-extrabold text-foreground">{fmt(MOCK.sales)}</p>
          <div className="text-right space-y-1">
            <div>
              <p className="text-[8px] text-muted-foreground">Goal</p>
              <p className="text-sm font-bold text-primary">{fmt(MOCK.projected)}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          <TrendingUp className="h-3 w-3 text-green-500" />
          <span className="text-[9px] text-green-500 font-medium">+{MOCK.prevDayChange}%</span>
        </div>
      </div>

      {/* Pace card */}
      <div className="rounded-xl bg-gradient-to-br from-amber-500/12 via-amber-500/6 to-transparent border border-amber-500/12 p-3">
        <p className="text-[9px] text-muted-foreground font-medium mb-0.5">PACE PROJECTION</p>
        <p className="text-2xl font-bold text-amber-600">{fmt(MOCK.pace)}</p>
      </div>

      {/* Stats grid - 2x3 */}
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza, bg: "bg-red-500/8 border-red-500/10", iconColor: "text-red-600" },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt, bg: "bg-blue-500/8 border-blue-500/10", iconColor: "text-blue-600" },
          { label: "Guests", value: String(MOCK.guests), icon: Users, bg: "bg-green-500/8 border-green-500/10", iconColor: "text-green-600" },
          { label: "Labor %", value: `${MOCK.laborPercent}%`, icon: Percent, bg: "bg-orange-500/8 border-orange-500/10", iconColor: "text-orange-600" },
          { label: "Cost", value: fmt(MOCK.laborCost), icon: DollarSign, bg: "bg-purple-500/8 border-purple-500/10", iconColor: "text-purple-600" },
          { label: "Hours", value: `${MOCK.laborHours}h`, icon: BarChart3, bg: "bg-cyan-500/8 border-cyan-500/10", iconColor: "text-cyan-600" },
        ].map((t) => (
          <div key={t.label} className={`rounded-lg ${t.bg} border p-2 text-center`}>
            <t.icon className={`h-3.5 w-3.5 ${t.iconColor} mx-auto mb-0.5`} />
            <p className="text-xs font-bold text-foreground">{t.value}</p>
            <p className="text-[7px] text-muted-foreground leading-tight">{t.label}</p>
          </div>
        ))}
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

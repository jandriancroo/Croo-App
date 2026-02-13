import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, DollarSign, Pizza, Receipt, Users, BarChart3, Percent } from "lucide-react";
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
  lwChange: 12.5,
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
    <CardContent className="pt-5 space-y-1">
       <div className="flex items-center justify-between">
         <h3 className="text-sm font-semibold text-foreground">Design 1 — Compact Tiles</h3>
       </div>

       {/* Hero tile with rounded edges */}
       <div className="relative rounded-2xl bg-orange-500 border border-orange-600 px-3 py-2">
         {/* Centered On Fire badge */}
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
           <Badge className="text-sm font-bold bg-white text-orange-500 border-white shadow-lg shadow-orange-900/30 px-4 py-1.5 pointer-events-auto">
             🔥 On Fire
           </Badge>
         </div>
         <div className="grid grid-cols-2 gap-1 items-center">
            <div>
              <p className="text-[10px] text-white/70 font-bold mb-0.5">Today's Sales</p>
              <p className="text-2xl font-extrabold text-white">{fmt(MOCK.sales)}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <TrendingUp className="h-3 w-3 text-white" />
                <span className="text-[9px] text-white font-medium">LW +{MOCK.lwChange}%</span>
              </div>
            </div>
            <div className="text-right space-y-0">
              <div>
                <p className="text-[9px] text-white/70 font-bold">Goal</p>
                <p className="text-lg font-bold text-white">{fmt(MOCK.projected)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-white/70 font-bold">Pace</p>
                <p className="text-lg font-bold text-white">{fmt(MOCK.pace)}</p>
              </div>
            </div>
         </div>
       </div>

      {/* Labor tile - system teal */}
      <div className="rounded-2xl bg-primary border border-primary/80 px-3 py-2">
        <div className="flex items-center divide-x divide-white/20">
          {[
            { label: "Labor %", value: `${MOCK.laborPercent}%`, icon: Percent },
            { label: "Labor Cost", value: fmt(MOCK.laborCost), icon: DollarSign },
            { label: "Hours", value: `${MOCK.laborHours}h`, icon: BarChart3 },
          ].map((t) => (
            <div key={t.label} className="flex-1 py-1 text-center">
              <t.icon className="h-3.5 w-3.5 text-white/60 mx-auto mb-0.5" />
              <p className="text-sm font-bold text-white">{t.value}</p>
              <p className="text-[10px] font-bold text-white/60">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Product tiles */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt },
          { label: "Guests", value: String(MOCK.guests), icon: Users },
        ].map((t) => (
          <div key={t.label} className="rounded-lg bg-muted/50 border border-border p-2 text-center">
            <t.icon className="h-3.5 w-3.5 text-muted-foreground mx-auto mb-0.5" />
            <p className="text-sm font-bold text-foreground">{t.value}</p>
            <p className="text-[10px] text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 2: "Minimal Stack" — no colored tiles, clean lines
// ============================================================================
const Design2 = () => (
  <Card>
    <CardContent className="pt-5 space-y-1">
      <h3 className="text-sm font-semibold text-foreground">Design 2 — Minimal Stack</h3>

      {/* Sales header - flat, no bg */}
      <div className="px-1 py-2">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground font-medium">Today's Sales</p>
            <p className="text-3xl font-extrabold text-foreground">{fmt(MOCK.sales)}</p>
          </div>
          <div className="text-right">
            <Badge variant="outline" className="text-xs border-primary text-primary">🔥 On Fire</Badge>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-muted-foreground">Goal <span className="text-foreground font-semibold">{fmt(MOCK.projected)}</span></span>
          <span className="text-xs text-muted-foreground">Pace <span className="text-foreground font-semibold">{fmt(MOCK.pace)}</span></span>
          <span className="text-xs text-primary font-medium flex items-center gap-0.5"><TrendingUp className="h-3 w-3" />+{MOCK.lwChange}%</span>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Labor row - inline with dividers */}
      <div className="flex items-center divide-x divide-border py-2">
        {[
          { label: "Labor %", value: `${MOCK.laborPercent}%` },
          { label: "Labor $", value: fmt(MOCK.laborCost) },
          { label: "Hours", value: `${MOCK.laborHours}h` },
        ].map((t) => (
          <div key={t.label} className="flex-1 text-center">
            <p className="text-sm font-bold text-foreground">{t.value}</p>
            <p className="text-[9px] text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-border" />

      {/* Product row - inline with dividers */}
      <div className="flex items-center divide-x divide-border py-2">
        {[
          { label: "Pizzas", value: String(MOCK.pizzas) },
          { label: "Avg Ticket", value: fmtDec(MOCK.avgTicket) },
          { label: "Guests", value: String(MOCK.guests) },
        ].map((t) => (
          <div key={t.label} className="flex-1 text-center">
            <p className="text-sm font-bold text-foreground">{t.value}</p>
            <p className="text-[9px] text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 3: "Bold Banner" — large hero number, horizontal stat bar
// ============================================================================
const Design3 = () => (
  <Card>
    <CardContent className="pt-5 space-y-1">
      <h3 className="text-sm font-semibold text-foreground">Design 3 — Bold Banner</h3>

      {/* Giant sales number */}
      <div className="rounded-2xl bg-primary px-4 py-3 text-center">
        <p className="text-[10px] text-white/60 font-bold tracking-wider uppercase">Today's Sales</p>
        <p className="text-4xl font-black text-white tracking-tight">{fmt(MOCK.sales)}</p>
        <div className="flex items-center justify-center gap-3 mt-1">
          <span className="text-[10px] text-white/70">Goal {fmt(MOCK.projected)}</span>
          <span className="text-white/30">|</span>
          <span className="text-[10px] text-white/70">Pace {fmt(MOCK.pace)}</span>
          <span className="text-white/30">|</span>
          <span className="text-[10px] text-white font-medium flex items-center gap-0.5"><TrendingUp className="h-3 w-3" />+{MOCK.lwChange}%</span>
        </div>
      </div>

      {/* All 6 metrics in a flat grid */}
      <div className="grid grid-cols-3 gap-px bg-border rounded-xl overflow-hidden">
        {[
          { label: "Labor %", value: `${MOCK.laborPercent}%`, icon: Percent },
          { label: "Labor $", value: fmt(MOCK.laborCost), icon: DollarSign },
          { label: "Hours", value: `${MOCK.laborHours}h`, icon: BarChart3 },
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt },
          { label: "Guests", value: String(MOCK.guests), icon: Users },
        ].map((t) => (
          <div key={t.label} className="bg-card py-2 text-center">
            <t.icon className="h-3 w-3 text-muted-foreground mx-auto mb-0.5" />
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
// DESIGN 4: "Split Panel" — left-right layout, sales vs labor
// ============================================================================
const Design4 = () => (
  <Card>
    <CardContent className="pt-5 space-y-1">
      <h3 className="text-sm font-semibold text-foreground">Design 4 — Split Panel</h3>

      <div className="flex gap-1">
        {/* Left: Sales */}
        <div className="flex-1 rounded-2xl bg-primary/10 border border-primary/20 p-3">
          <p className="text-[9px] text-primary font-bold uppercase tracking-wider">Sales</p>
          <p className="text-2xl font-black text-foreground mt-0.5">{fmt(MOCK.sales)}</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Goal</span>
              <span className="font-semibold text-foreground">{fmt(MOCK.projected)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Pace</span>
              <span className="font-semibold text-foreground">{fmt(MOCK.pace)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">vs LW</span>
              <span className="font-semibold text-primary">+{MOCK.lwChange}%</span>
            </div>
          </div>
        </div>

        {/* Right: Labor */}
        <div className="flex-1 rounded-2xl bg-muted/50 border border-border p-3">
          <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Labor</p>
          <p className="text-2xl font-black text-foreground mt-0.5">{MOCK.laborPercent}%</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Cost</span>
              <span className="font-semibold text-foreground">{fmt(MOCK.laborCost)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Hours</span>
              <span className="font-semibold text-foreground">{MOCK.laborHours}h</span>
            </div>
          </div>
        </div>
      </div>

      {/* Product row */}
      <div className="flex items-center divide-x divide-border rounded-xl border border-border py-2">
        {[
          { label: "Pizzas", value: String(MOCK.pizzas), icon: Pizza },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket), icon: Receipt },
          { label: "Guests", value: String(MOCK.guests), icon: Users },
        ].map((t) => (
          <div key={t.label} className="flex-1 text-center">
            <t.icon className="h-3 w-3 text-muted-foreground mx-auto mb-0.5" />
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
// DESIGN 5: "Scoreboard" — sports-style with big numbers
// ============================================================================
const Design5 = () => (
  <Card>
    <CardContent className="pt-5 space-y-1">
      <h3 className="text-sm font-semibold text-foreground">Design 5 — Scoreboard</h3>

      {/* Hero tile - exact copy from Design 1 */}
      <div className="relative rounded-2xl bg-orange-500 border border-orange-600 px-3 py-2">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <Badge className="text-sm font-bold bg-white text-orange-500 border-white shadow-lg shadow-orange-900/30 px-4 py-1.5 pointer-events-auto">
            🔥 On Fire
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-1 items-center">
          <div>
            <p className="text-[10px] text-white/70 font-bold mb-0.5">Today's Sales</p>
            <p className="text-2xl font-extrabold text-white">{fmt(MOCK.sales)}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <TrendingUp className="h-3 w-3 text-white" />
              <span className="text-[9px] text-white font-medium">LW +{MOCK.lwChange}%</span>
            </div>
          </div>
          <div className="text-right space-y-0">
            <div>
              <p className="text-[9px] text-white/70 font-bold">Goal</p>
              <p className="text-lg font-bold text-white">{fmt(MOCK.projected)}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-white/70 font-bold">Pace</p>
              <p className="text-lg font-bold text-white">{fmt(MOCK.pace)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Labor strip */}
      <div className="rounded-2xl bg-primary px-3 py-2">
        <div className="flex items-center divide-x divide-white/20">
          {[
            { label: "Labor %", value: `${MOCK.laborPercent}%` },
            { label: "Labor $", value: fmt(MOCK.laborCost) },
            { label: "Hours", value: `${MOCK.laborHours}h` },
          ].map((t) => (
            <div key={t.label} className="flex-1 text-center">
              <p className="text-sm font-bold text-white">{t.value}</p>
              <p className="text-[10px] text-white/60">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Product strip */}
      <div className="flex items-center divide-x divide-border rounded-xl border border-border py-2">
        {[
          { label: "Pizzas", value: String(MOCK.pizzas) },
          { label: "Ticket", value: fmtDec(MOCK.avgTicket) },
          { label: "Guests", value: String(MOCK.guests) },
        ].map((t) => (
          <div key={t.label} className="flex-1 text-center">
            <p className="text-sm font-bold text-foreground">{t.value}</p>
            <p className="text-[10px] text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      <SalesChart />
    </CardContent>
  </Card>
);

// ============================================================================
// DESIGN 6: "Card List" — each metric is its own row
// ============================================================================
const Design6 = () => (
  <Card>
    <CardContent className="pt-5 space-y-1">
      <h3 className="text-sm font-semibold text-foreground">Design 6 — Card List</h3>

      {/* Hero row */}
      <div className="flex items-center justify-between rounded-2xl bg-primary px-4 py-2.5">
        <div>
          <p className="text-[9px] text-white/60 font-bold">TODAY'S SALES</p>
          <p className="text-2xl font-black text-white">{fmt(MOCK.sales)}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-lg font-bold text-white/80">{fmt(MOCK.projected)}</p>
            <p className="text-[8px] text-white/50">Goal</p>
          </div>
          <div className="w-px h-8 bg-white/20" />
          <div className="text-right">
            <p className="text-lg font-bold text-white">{fmt(MOCK.pace)}</p>
            <p className="text-[8px] text-white/50">Pace</p>
          </div>
        </div>
      </div>

      {/* Metric rows */}
      {[
        { label: "Labor", primary: `${MOCK.laborPercent}%`, secondary: `${fmt(MOCK.laborCost)} · ${MOCK.laborHours}h`, icon: Percent, accent: true },
        { label: "Pizzas Sold", primary: String(MOCK.pizzas), secondary: `${fmtDec(MOCK.avgTicket)} avg ticket`, icon: Pizza, accent: false },
        { label: "Guest Count", primary: String(MOCK.guests), secondary: `+${MOCK.lwChange}% vs last week`, icon: Users, accent: false },
      ].map((row) => (
        <div key={row.label} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${row.accent ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50 border border-border'}`}>
          <div className={`rounded-lg p-1.5 ${row.accent ? 'bg-primary/20' : 'bg-muted'}`}>
            <row.icon className={`h-4 w-4 ${row.accent ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div className="flex-1">
            <p className="text-[9px] text-muted-foreground font-medium">{row.label}</p>
            <p className="text-sm font-bold text-foreground">{row.primary}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">{row.secondary}</p>
        </div>
      ))}

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
            <p className="text-xs text-muted-foreground">6 layout variations</p>
          </div>
        </div>

        <Design1 />
        <Design2 />
        <Design3 />
        <Design4 />
        <Design5 />
        <Design6 />
      </div>
    </div>
  );
};

export default SalesDesignPreview;

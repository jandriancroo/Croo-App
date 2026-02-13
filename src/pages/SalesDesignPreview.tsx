import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ResponsiveContainer, ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { motion, AnimatePresence } from "framer-motion";

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

// Shared collapsed tab + expand logic used across all variations
const CollapsibleScoreboard = ({
  title,
  heroContent,
  expandedContent,
}: {
  title: string;
  heroContent: (expanded: boolean, toggle: () => void) => React.ReactNode;
  expandedContent: React.ReactNode;
}) => {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((v) => !v);

  return (
    <Card>
      <CardContent className="pt-5 space-y-0">
        <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
        {heroContent(expanded, toggle)}

        {/* Collapsed tab */}
        <AnimatePresence mode="wait">
          {!expanded && (
            <motion.div
              key="collapsed-tab"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div
                className="mx-auto w-36 bg-primary rounded-b-xl px-3 py-1.5 flex items-center justify-center gap-1.5 cursor-pointer select-none shadow-md"
                onClick={() => setExpanded(true)}
              >
                <p className="text-xs font-bold text-white">{MOCK.laborPercent}%</p>
                <p className="text-[10px] text-white/60">Labor %</p>
                <ChevronDown className="h-3 w-3 text-white/60" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expanded */}
        <AnimatePresence mode="wait">
          {expanded && (
            <motion.div
              key="expanded-details"
              initial={{ opacity: 0, height: 0, scaleY: 0.8 }}
              animate={{ opacity: 1, height: "auto", scaleY: 1 }}
              exit={{ opacity: 0, height: 0, scaleY: 0.8 }}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="origin-top overflow-hidden space-y-1"
            >
              {expandedContent}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="pt-1">
          <SalesChart />
        </div>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// Shared expanded content (labor + product strips)
// ============================================================================
const StandardExpandedContent = () => (
  <>
    <div className="rounded-2xl bg-primary px-3 py-2" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
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
  </>
);

// ============================================================================
// VARIATION A: "Classic" — Original orange hero with centered badge
// ============================================================================
const VariationA = () => (
  <CollapsibleScoreboard
    title="Variation A — Classic Badge"
    heroContent={(expanded, toggle) => (
      <div
        className="relative rounded-2xl bg-orange-500 border border-orange-600 px-3 py-2 cursor-pointer select-none"
        style={{ borderBottomLeftRadius: expanded ? '0' : undefined, borderBottomRightRadius: expanded ? '0' : undefined }}
        onClick={toggle}
      >
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
    )}
    expandedContent={<StandardExpandedContent />}
  />
);

// ============================================================================
// VARIATION B: "Top Badge" — Badge pinned top-right, bigger sales number
// ============================================================================
const VariationB = () => (
  <CollapsibleScoreboard
    title="Variation B — Top Badge, Bold Sales"
    heroContent={(expanded, toggle) => (
      <div
        className="relative rounded-2xl bg-orange-500 border border-orange-600 px-4 py-3 cursor-pointer select-none"
        style={{ borderBottomLeftRadius: expanded ? '0' : undefined, borderBottomRightRadius: expanded ? '0' : undefined }}
        onClick={toggle}
      >
        {/* Badge top-right */}
        <div className="absolute top-2 right-2 z-10">
          <Badge className="text-[10px] font-bold bg-white text-orange-500 border-white shadow-lg shadow-orange-900/30 px-2 py-0.5">
            🔥 On Fire
          </Badge>
        </div>

        <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider">Today's Sales</p>
        <p className="text-4xl font-black text-white tracking-tight mt-0.5">{fmt(MOCK.sales)}</p>
        <div className="flex items-center gap-4 mt-2">
          <div>
            <p className="text-[9px] text-white/50 font-bold">Goal</p>
            <p className="text-base font-bold text-white/80">{fmt(MOCK.projected)}</p>
          </div>
          <div className="w-px h-6 bg-white/20" />
          <div>
            <p className="text-[9px] text-white/50 font-bold">Pace</p>
            <p className="text-base font-bold text-white">{fmt(MOCK.pace)}</p>
          </div>
          <div className="w-px h-6 bg-white/20" />
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-white" />
            <span className="text-xs text-white font-semibold">+{MOCK.lwChange}%</span>
            <span className="text-[9px] text-white/50">LW</span>
          </div>
        </div>
      </div>
    )}
    expandedContent={<StandardExpandedContent />}
  />
);

// ============================================================================
// VARIATION C: "Progress Bar" — visual progress toward goal
// ============================================================================
const VariationC = () => {
  const progress = Math.min((MOCK.sales / MOCK.projected) * 100, 100);

  return (
    <CollapsibleScoreboard
      title="Variation C — Progress Bar"
      heroContent={(expanded, toggle) => (
        <div
          className="relative rounded-2xl bg-orange-500 border border-orange-600 px-3 py-2.5 cursor-pointer select-none"
          style={{ borderBottomLeftRadius: expanded ? '0' : undefined, borderBottomRightRadius: expanded ? '0' : undefined }}
          onClick={toggle}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider">Today's Sales</p>
              <p className="text-3xl font-black text-white tracking-tight">{fmt(MOCK.sales)}</p>
            </div>
            <div className="text-right">
              <Badge className="text-[10px] font-bold bg-white text-orange-500 border-white shadow-lg shadow-orange-900/30 px-2 py-0.5 mb-1">
                🔥 On Fire
              </Badge>
              <div className="flex items-center gap-1 justify-end">
                <TrendingUp className="h-3 w-3 text-white" />
                <span className="text-xs text-white font-semibold">+{MOCK.lwChange}%</span>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-2 mb-1">
            <div className="flex items-center justify-between text-[9px] text-white/60 mb-1">
              <span>Progress to Goal</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-white rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-[10px] text-white/60">Goal <span className="text-white font-semibold">{fmt(MOCK.projected)}</span></span>
            <span className="text-white/30">·</span>
            <span className="text-[10px] text-white/60">Pace <span className="text-white font-semibold">{fmt(MOCK.pace)}</span></span>
          </div>
        </div>
      )}
      expandedContent={<StandardExpandedContent />}
    />
  );
};



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
            <h1 className="text-xl font-bold text-foreground">Scoreboard Finals</h1>
            <p className="text-xs text-muted-foreground">3 variations — tap to expand</p>
          </div>
        </div>

        <VariationA />
        <VariationB />
        <VariationC />
      </div>
    </div>
  );
};

export default SalesDesignPreview;

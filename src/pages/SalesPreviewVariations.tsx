import { ChevronLeft, ChevronRight, ChevronDown, TrendingUp, Package, Flame } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

const chartData = [
  { hour: '11am', sales: 180, projected: 150 },
  { hour: '12pm', sales: 320, projected: 280 },
  { hour: '1pm', sales: 290, projected: 300 },
  { hour: '2pm', sales: 180, projected: 200 },
  { hour: '3pm', sales: 220, projected: 250 },
  { hour: '4pm', sales: 280, projected: 300 },
  { hour: '5pm', sales: 480, projected: 380 },
  { hour: '6pm', sales: 520, projected: 400 },
  { hour: '7pm', sales: 380, projected: 350 },
  { hour: '8pm', sales: 280, projected: 280 },
  { hour: '9pm', sales: 200, projected: 220 },
];

type BadgeStyle = 'corner' | 'inline';

interface Variation {
  name: string;
  badgeStyle: BadgeStyle;
  heroBg: string;
  heroBorder: string;
  heroText: string;
  heroSubtext: string;
  laborBg: string;
  laborText: string;
  laborSubtext: string;
  chartBar: string;
  heroFrosted?: boolean;
  // corner badge colors
  cornerBg?: string;
  cornerText?: string;
}

const frostedStyle = {
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
};

const colorSets = [
  {
    label: 'Current — Orange hero, Teal labor',
    heroBg: '#ee7a3a', heroBorder: '#d96a2e', heroText: '#ffffff', heroSubtext: 'rgba(255,255,255,0.7)',
    laborBg: '#4a9ba7', laborText: '#ffffff', laborSubtext: 'rgba(255,255,255,0.6)', chartBar: '#4a9ba7',
    cornerBg: '#ffffff', cornerText: '#ee7a3a',
  },
  {
    label: 'White hero, Orange labor',
    heroBg: '#ffffff', heroBorder: '#e5e7eb', heroText: '#1a1a1a', heroSubtext: 'rgba(0,0,0,0.5)',
    laborBg: '#ee7a3a', laborText: '#ffffff', laborSubtext: 'rgba(255,255,255,0.6)', chartBar: '#ee7a3a',
    cornerBg: '#ee7a3a', cornerText: '#ffffff',
  },
  {
    label: 'Frosted hero, Teal labor',
    heroBg: 'rgba(255,255,255,0.6)', heroBorder: 'rgba(74,155,167,0.3)', heroText: '#1a1a1a', heroSubtext: 'rgba(0,0,0,0.5)',
    heroFrosted: true,
    laborBg: '#4a9ba7', laborText: '#ffffff', laborSubtext: 'rgba(255,255,255,0.6)', chartBar: '#4a9ba7',
    cornerBg: '#4a9ba7', cornerText: '#ffffff',
  },
];

const variations: Variation[] = [];
const badgeStyles: BadgeStyle[] = ['corner', 'inline'];
let idx = 1;
for (const badge of badgeStyles) {
  for (const c of colorSets) {
    variations.push({
      name: `${idx}. ${badge === 'corner' ? 'Corner' : 'Inline'} — ${c.label}`,
      badgeStyle: badge,
      heroBg: c.heroBg, heroBorder: c.heroBorder, heroText: c.heroText, heroSubtext: c.heroSubtext,
      laborBg: c.laborBg, laborText: c.laborText, laborSubtext: c.laborSubtext, chartBar: c.chartBar,
      heroFrosted: c.heroFrosted,
      cornerBg: c.cornerBg, cornerText: c.cornerText,
    });
    idx++;
  }
}

function SalesVariation({ v }: { v: Variation }) {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-2 bg-muted/50 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground">{v.name}</p>
      </div>
      <div className="p-4 space-y-0">
        {/* Nav Bar — always teal */}
        <div className="rounded-lg px-3 py-1.5 flex items-center justify-between mb-2" style={{ backgroundColor: '#4a9ba7' }}>
          <button className="h-8 w-8 flex items-center justify-center rounded-full">
            <ChevronLeft className="h-5 w-5 text-white" />
          </button>
          <div className="rounded-md px-3 py-1" style={{ backgroundColor: v.name.startsWith('4.') ? 'transparent' : 'rgba(255,255,255,0.15)' }}>
            <span className="text-base font-semibold text-white">Today</span>
          </div>
          <button className="h-8 w-8 flex items-center justify-center rounded-full opacity-50">
            <ChevronRight className="h-5 w-5 text-white" />
          </button>
        </div>

        {/* Hero Tile */}
        <div
          className="relative rounded-2xl px-3 py-2 border"
          style={{
            backgroundColor: v.heroBg,
            borderColor: v.heroBorder,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            ...(v.heroFrosted ? frostedStyle : {}),
          }}
        >
          {/* Corner badge */}
          {v.badgeStyle === 'corner' && (
            <div className="absolute top-0 right-0 z-10">
              <div
                className="text-[10px] font-bold px-2.5 py-1 rounded-bl-lg rounded-tr-xl shadow-md flex items-center gap-1"
                style={{ backgroundColor: v.cornerBg, color: v.cornerText }}
              >
                <Flame className="h-3 w-3" />
                On Fire
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 items-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: v.heroSubtext }}>TODAY'S SALES</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-extrabold" style={{ color: v.heroText }}>$2,847</p>
                {/* Inline badge — centered overlay */}
                {v.badgeStyle === 'inline' && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5 shadow-sm" style={{ backgroundColor: v.heroText === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.08)' }}>
                      <Flame className="h-4 w-4" style={{ color: v.heroText }} />
                      <span className="text-sm font-bold" style={{ color: v.heroText }}>On Fire</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <TrendingUp className="h-3 w-3" style={{ color: v.heroText }} />
                <span className="text-[9px] font-medium" style={{ color: v.heroText }}>+12.3% vs Thu</span>
              </div>
            </div>
            <div className="text-right space-y-0">
              <div>
                <p className="text-[9px] font-bold" style={{ color: v.heroSubtext }}>Goal</p>
                <p className="text-lg font-bold" style={{ color: v.heroText }}>$3,800</p>
              </div>
              <div>
                <p className="text-[9px] font-bold" style={{ color: v.heroSubtext }}>Pace</p>
                <p className="text-lg font-bold" style={{ color: v.heroText }}>$4,120</p>
              </div>
            </div>
          </div>
        </div>

        {/* Collapsed Labor Tab */}
        <div className="flex justify-center">
          <div
            className="w-36 rounded-b-xl px-3 py-1.5 flex items-center justify-center gap-1.5 shadow-md"
            style={{ backgroundColor: v.laborBg, ...(v.heroFrosted ? {} : {}) }}
          >
            <p className="text-xs font-bold" style={{ color: v.laborText }}>24.2%</p>
            <p className="text-[10px]" style={{ color: v.laborSubtext }}>Labor %</p>
            <ChevronDown className="h-3 w-3" style={{ color: v.laborSubtext }} />
          </div>
        </div>

        {/* Chart */}
        <div className="pt-3">
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} barCategoryGap="10%" margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: 'hsl(var(--foreground))', fontSize: 9 }} interval="preserveStartEnd" angle={-45} textAnchor="end" height={40} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(var(--foreground))', fontSize: 9 }} tickFormatter={val => `$${val}`} width={35} axisLine={false} tickLine={false} />
              <Legend formatter={(val) => val === 'Projected' ? 'Projected' : 'Actual'} wrapperStyle={{ fontSize: '10px' }} />
              <Area type="monotone" dataKey="projected" name="Projected" stroke="hsl(var(--muted-foreground))" strokeWidth={2} fill="hsl(var(--muted-foreground) / 0.15)" />
              <Bar dataKey="sales" name="Actual" fill={v.chartBar} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="pt-1">
          <button className="w-full flex items-center justify-between h-8 px-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Top 20 Products by Sales
            </span>
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SalesPreviewVariations() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales Summary — Badge + Color Combos</h1>
          <p className="text-sm text-muted-foreground">Corner tag vs Inline badge across 3 color arrangements</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {variations.map((v, i) => (
            <SalesVariation key={i} v={v} />
          ))}
        </div>
      </div>
    </div>
  );
}

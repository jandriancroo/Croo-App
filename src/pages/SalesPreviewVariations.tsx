import { ChevronLeft, ChevronRight, ChevronDown, TrendingUp, Package } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { Badge } from '@/components/ui/badge';

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

// Colors: orange=#ee7a3a, teal=#4a9ba7, white=#ffffff, frosted=white/60 backdrop-blur

interface Variation {
  name: string;
  // nav bar
  navBg: string;
  navText: string;
  navCenterBg: string;
  // hero tile
  heroBg: string;
  heroBorder: string;
  heroText: string;
  heroSubtext: string;
  // badge
  badgeBg: string;
  badgeText: string;
  // labor tab
  laborBg: string;
  laborText: string;
  laborSubtext: string;
  // chart bar
  chartBar: string;
  // frosted glass effect on any element
  navFrosted?: boolean;
  heroFrosted?: boolean;
  laborFrosted?: boolean;
}

const variations: Variation[] = [
  {
    name: '1. Current — Orange hero, Teal labor & chart',
    navBg: '#4a9ba7',
    navText: '#ffffff',
    navCenterBg: 'rgba(255,255,255,0.15)',
    heroBg: '#ee7a3a',
    heroBorder: '#d96a2e',
    heroText: '#ffffff',
    heroSubtext: 'rgba(255,255,255,0.7)',
    badgeBg: '#ffffff',
    badgeText: '#ee7a3a',
    laborBg: '#4a9ba7',
    laborText: '#ffffff',
    laborSubtext: 'rgba(255,255,255,0.6)',
    chartBar: '#4a9ba7',
  },
  {
    name: '2. White hero, Orange labor & chart',
    navBg: '#4a9ba7',
    navText: '#ffffff',
    navCenterBg: 'rgba(255,255,255,0.15)',
    heroBg: '#ffffff',
    heroBorder: '#e5e7eb',
    heroText: '#1a1a1a',
    heroSubtext: 'rgba(0,0,0,0.5)',
    badgeBg: '#ee7a3a',
    badgeText: '#ffffff',
    laborBg: '#ee7a3a',
    laborText: '#ffffff',
    laborSubtext: 'rgba(255,255,255,0.6)',
    chartBar: '#ee7a3a',
  },
  {
    name: '3. Frosted hero, Teal labor & chart',
    navBg: '#4a9ba7',
    navText: '#ffffff',
    navCenterBg: 'rgba(255,255,255,0.15)',
    heroBg: 'rgba(255,255,255,0.6)',
    heroBorder: 'rgba(74,155,167,0.3)',
    heroFrosted: true,
    heroText: '#1a1a1a',
    heroSubtext: 'rgba(0,0,0,0.5)',
    badgeBg: '#4a9ba7',
    badgeText: '#ffffff',
    laborBg: '#4a9ba7',
    laborText: '#ffffff',
    laborSubtext: 'rgba(255,255,255,0.6)',
    chartBar: '#4a9ba7',
  },
];

function SalesVariation({ v }: { v: Variation }) {
  const frostedStyle = {
    backdropFilter: 'blur(40px) saturate(180%)',
    WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  };

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-2 bg-muted/50 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground">{v.name}</p>
      </div>
      <div className="p-4 space-y-0">
        {/* Nav Bar */}
        <div
          className="rounded-lg px-3 py-1.5 flex items-center justify-between mb-2"
          style={{
            backgroundColor: v.navBg,
            ...(v.navFrosted ? frostedStyle : {}),
          }}
        >
          <button className="h-8 w-8 flex items-center justify-center rounded-full">
            <ChevronLeft className="h-5 w-5" style={{ color: v.navText }} />
          </button>
          <div className="rounded-md px-3 py-1" style={{ backgroundColor: v.navCenterBg }}>
            <span className="text-base font-semibold" style={{ color: v.navText }}>Today</span>
          </div>
          <button className="h-8 w-8 flex items-center justify-center rounded-full" style={{ opacity: 0.5 }}>
            <ChevronRight className="h-5 w-5" style={{ color: v.navText }} />
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
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <Badge
              className="text-sm font-bold border-white shadow-lg px-4 py-1.5"
              style={{ backgroundColor: v.badgeBg, color: v.badgeText }}
            >
              🔥 On Fire
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-1 items-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: v.heroSubtext }}>TODAY'S SALES</p>
              <p className="text-2xl font-extrabold" style={{ color: v.heroText }}>$2,847</p>
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
            style={{
              backgroundColor: v.laborBg,
              ...(v.laborFrosted ? frostedStyle : {}),
            }}
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
          <h1 className="text-2xl font-bold text-foreground">Sales Summary — Color Arrangements</h1>
          <p className="text-sm text-muted-foreground">Same 4 colors (orange, teal, white, frosted) applied differently</p>
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

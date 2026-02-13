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

interface ColorScheme {
  name: string;
  navBg: string;
  heroBg: string;
  heroBorder: string;
  laborBg: string;
  chartBar: string;
  badgeBg: string;
  badgeText: string;
}

const colorSchemes: ColorScheme[] = [
  {
    name: '1. Current — Orange / Teal',
    navBg: '#4a9ba7',
    heroBg: '#ee7a3a',
    heroBorder: '#d96a2e',
    laborBg: '#4a9ba7',
    chartBar: '#4a9ba7',
    badgeBg: '#ffffff',
    badgeText: '#ee7a3a',
  },
  {
    name: '2. Burnt Sienna / Slate',
    navBg: '#475569',
    heroBg: '#c0623a',
    heroBorder: '#a8522f',
    laborBg: '#475569',
    chartBar: '#475569',
    badgeBg: '#ffffff',
    badgeText: '#c0623a',
  },
  {
    name: '3. Warm Amber / Charcoal',
    navBg: '#374151',
    heroBg: '#d97706',
    heroBorder: '#b45309',
    laborBg: '#374151',
    chartBar: '#374151',
    badgeBg: '#ffffff',
    badgeText: '#d97706',
  },
  {
    name: '4. Terracotta / Forest',
    navBg: '#2d5a3d',
    heroBg: '#c2664a',
    heroBorder: '#a85540',
    laborBg: '#2d5a3d',
    chartBar: '#2d5a3d',
    badgeBg: '#ffffff',
    badgeText: '#c2664a',
  },
  {
    name: '5. Coral / Navy',
    navBg: '#1e3a5f',
    heroBg: '#e8734a',
    heroBorder: '#d0633e',
    laborBg: '#1e3a5f',
    chartBar: '#1e3a5f',
    badgeBg: '#ffffff',
    badgeText: '#e8734a',
  },
];

function SalesVariation({ scheme }: { scheme: ColorScheme }) {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-2 bg-muted/50 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground">{scheme.name}</p>
      </div>
      <div className="p-4 space-y-0">
        {/* Nav Bar */}
        <div 
          className="rounded-lg px-3 py-1.5 flex items-center justify-between mb-2"
          style={{ backgroundColor: scheme.navBg }}
        >
          <button className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-white/20">
            <ChevronLeft className="h-5 w-5 text-white" />
          </button>
          <div className="bg-white/15 rounded-md px-3 py-1">
            <span className="text-base text-white font-semibold">Today</span>
          </div>
          <button className="h-8 w-8 flex items-center justify-center rounded-full text-white/50">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Hero Tile */}
        <div 
          className="relative rounded-2xl px-3 py-2 border"
          style={{ 
            backgroundColor: scheme.heroBg, 
            borderColor: scheme.heroBorder,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          }}
        >
          {/* Center Badge */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <Badge 
              className="text-sm font-bold border-white shadow-lg px-4 py-1.5"
              style={{ backgroundColor: scheme.badgeBg, color: scheme.badgeText }}
            >
              🔥 On Fire
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-1 items-center">
            <div>
              <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider mb-0.5">TODAY'S SALES</p>
              <p className="text-2xl font-extrabold text-white">$2,847</p>
              <div className="flex items-center gap-1 mt-0.5">
                <TrendingUp className="h-3 w-3 text-white" />
                <span className="text-[9px] text-white font-medium">+12.3% vs Thu</span>
              </div>
            </div>
            <div className="text-right space-y-0">
              <div>
                <p className="text-[9px] text-white/70 font-bold">Goal</p>
                <p className="text-lg font-bold text-white">$3,800</p>
              </div>
              <div>
                <p className="text-[9px] text-white/70 font-bold">Pace</p>
                <p className="text-lg font-bold text-white">$4,120</p>
              </div>
            </div>
          </div>
        </div>

        {/* Collapsed Labor Tab */}
        <div className="flex justify-center">
          <div
            className="w-36 rounded-b-xl px-3 py-1.5 flex items-center justify-center gap-1.5 shadow-md"
            style={{ backgroundColor: scheme.laborBg }}
          >
            <p className="text-xs font-bold text-white">24.2%</p>
            <p className="text-[10px] text-white/60">Labor %</p>
            <ChevronDown className="h-3 w-3 text-white/60" />
          </div>
        </div>

        {/* Chart */}
        <div className="pt-3">
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} barCategoryGap="10%" margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" vertical={false} />
              <XAxis 
                dataKey="hour" 
                tick={{ fill: 'hsl(var(--foreground))', fontSize: 9 }} 
                interval="preserveStartEnd" 
                angle={-45} 
                textAnchor="end" 
                height={40} 
                axisLine={false} 
                tickLine={false} 
              />
              <YAxis 
                tick={{ fill: 'hsl(var(--foreground))', fontSize: 9 }} 
                tickFormatter={v => `$${v}`} 
                width={35} 
                axisLine={false} 
                tickLine={false} 
              />
              <Legend 
                formatter={(value) => value === 'Projected' ? 'Projected' : 'Actual'} 
                wrapperStyle={{ fontSize: '10px' }} 
              />
              <Area
                type="monotone"
                dataKey="projected"
                name="Projected"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={2}
                fill="hsl(var(--muted-foreground) / 0.15)"
              />
              <Bar 
                dataKey="sales" 
                name="Actual" 
                fill={scheme.chartBar} 
                radius={[4, 4, 0, 0]} 
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Product Mix Preview */}
        <div className="pt-1">
          <button className="w-full flex items-center justify-between h-8 px-2 text-sm text-muted-foreground hover:text-foreground">
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
          <h1 className="text-2xl font-bold text-foreground">Sales Summary — Color Variations</h1>
          <p className="text-sm text-muted-foreground">Same layout, 5 different color combos. Pick your favorite.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {colorSchemes.map((scheme, i) => (
            <SalesVariation key={i} scheme={scheme} />
          ))}
        </div>
      </div>
    </div>
  );
}

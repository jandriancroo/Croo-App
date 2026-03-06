import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, Flame } from "lucide-react";
import { useIsOledTheme } from "@/hooks/useIsOledTheme";

export interface OrgLocationData {
  locationId: string;
  locationName: string;
  storeNumber?: string | null;
  // Layer 1: Hero numbers
  salesToday: number;
  paceToday: number | null;
  goalToday: number | null;
  // Layer 2: Sparkline (last 7 days net_sales)
  last7Days: number[];
  // Layer 3: Comparisons
  salesWtd: number;
  salesPrevWeek: number | null;
  salesMtd: number;
  salesPrevMonth: number | null;
  salesLastYearDay: number | null;
  // Layer 4: Labor
  laborPercent: number | null;
  laborCost: number | null;
  // Layer 5: Hourly heatmap (24 slots, index = hour)
  hourlyData: number[];
}

interface OrgLocationCubeProps {
  data: OrgLocationData;
  isLoading?: boolean;
  onClick?: () => void;
}

function getPaceStatus(pace: number | null, goal: number | null): { label: string; color: string; icon: typeof Flame } {
  if (!pace || !goal || goal === 0) return { label: '', color: 'hsl(var(--muted-foreground))', icon: Minus };
  const pct = (pace / goal) * 100;
  if (pct >= 110) return { label: 'On Fire', color: '#22c55e', icon: Flame };
  if (pct >= 105) return { label: 'Ahead', color: '#22c55e', icon: TrendingUp };
  if (pct >= 95) return { label: 'On Track', color: '#eab308', icon: Minus };
  return { label: 'Behind', color: '#ef4444', icon: TrendingDown };
}

function getLaborColor(pct: number | null): string {
  if (pct === null) return 'hsl(var(--muted-foreground))';
  if (pct < 28) return '#22c55e';
  if (pct <= 32) return '#eab308';
  return '#ef4444';
}

function formatCurrency(val: number): string {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`;
  return `$${Math.round(val).toLocaleString()}`;
}

function pctChange(current: number, prev: number | null): string {
  if (!prev || prev === 0) return '--';
  const pct = ((current - prev) / prev) * 100;
  const arrow = pct >= 0 ? '▲' : '▼';
  return `${arrow}${Math.abs(pct).toFixed(1)}%`;
}

function pctChangeColor(current: number, prev: number | null): string {
  if (!prev || prev === 0) return 'hsl(var(--muted-foreground))';
  return current >= prev ? '#22c55e' : '#ef4444';
}

// Tiny sparkline SVG
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100;
  const h = 24;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <linearGradient id={`grad-${color.replace('#','')}`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient>
      <polygon
        fill={`url(#grad-${color.replace('#','')})`}
        points={`0,${h} ${points} ${w},${h}`}
      />
    </svg>
  );
}

// Hourly heatmap - tiny blocks
function HourlyHeatmap({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  // Business hours only (7-23)
  const businessHours = data.slice(7, 24);
  
  return (
    <div className="flex gap-[1px] items-end h-4">
      {businessHours.map((val, i) => {
        const intensity = max > 0 ? val / max : 0;
        let bg = 'hsl(var(--muted))';
        if (intensity > 0.7) bg = '#22c55e';
        else if (intensity > 0.4) bg = '#eab308';
        else if (intensity > 0.05) bg = 'hsl(var(--muted-foreground)/0.3)';
        
        return (
          <div
            key={i}
            className="flex-1 min-w-[3px] rounded-[1px]"
            style={{ 
              backgroundColor: bg,
              height: `${Math.max(15, intensity * 100)}%`,
            }}
          />
        );
      })}
    </div>
  );
}

// Labor gauge - mini circular
function LaborGauge({ percent }: { percent: number | null }) {
  const pct = percent ?? 0;
  const color = getLaborColor(percent);
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(pct / 40, 1); // 40% = full circle
  const offset = circumference * (1 - filled);

  return (
    <div className="relative w-9 h-9 flex items-center justify-center">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
        <circle
          cx="18" cy="18" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-[9px] font-bold" style={{ color }}>
        {percent !== null ? `${percent.toFixed(0)}%` : '--'}
      </span>
    </div>
  );
}

export function OrgLocationCube({ data, isLoading, onClick }: OrgLocationCubeProps) {
  const isOled = useIsOledTheme();
  const paceStatus = getPaceStatus(data.paceToday, data.goalToday);
  const PaceIcon = paceStatus.icon;
  const displayName = data.storeNumber 
    ? `${data.locationName} - ${data.storeNumber}` 
    : data.locationName;

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3 animate-pulse">
        <div className="h-4 bg-muted rounded w-2/3" />
        <div className="h-8 bg-muted rounded" />
        <div className="h-6 bg-muted rounded" />
        <div className="h-4 bg-muted rounded w-1/2" />
        <div className="h-4 bg-muted rounded" />
      </Card>
    );
  }

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:shadow-lg hover:scale-[1.01] transition-all duration-200 group"
      onClick={onClick}
      style={{
        borderColor: isOled ? undefined : `${paceStatus.color}20`,
      }}
    >
      <div className="p-3 md:p-4 space-y-2.5">
        {/* === LAYER 1: Hero Numbers === */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-muted-foreground truncate">
              {displayName}
            </div>
            <div className="text-2xl md:text-3xl font-black tracking-tight">
              {formatCurrency(data.salesToday)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <div className="flex items-center gap-1">
              <PaceIcon className="h-3.5 w-3.5" style={{ color: paceStatus.color }} />
              <span className="text-xs font-semibold" style={{ color: paceStatus.color }}>
                {paceStatus.label}
              </span>
            </div>
            {data.paceToday !== null && (
              <span className="text-sm font-bold" style={{ color: paceStatus.color }}>
                {formatCurrency(data.paceToday)}
              </span>
            )}
            {data.goalToday !== null && (
              <span className="text-[10px] text-muted-foreground">
                Goal: {formatCurrency(data.goalToday)}
              </span>
            )}
          </div>
        </div>

        {/* === LAYER 2: 7-Day Sparkline === */}
        <div className="relative">
          <Sparkline data={data.last7Days} color={paceStatus.color} />
          <span className="absolute right-0 top-0 text-[9px] text-muted-foreground">7d</span>
        </div>

        {/* === LAYER 3: Comparison Row === */}
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">WTD</span>
            <span className="font-semibold">{formatCurrency(data.salesWtd)}</span>
            <span className="font-medium" style={{ color: pctChangeColor(data.salesWtd, data.salesPrevWeek) }}>
              {pctChange(data.salesWtd, data.salesPrevWeek)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">MTD</span>
            <span className="font-semibold">{formatCurrency(data.salesMtd)}</span>
            <span className="font-medium" style={{ color: pctChangeColor(data.salesMtd, data.salesPrevMonth) }}>
              {pctChange(data.salesMtd, data.salesPrevMonth)}
            </span>
          </div>
          {data.salesLastYearDay !== null && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">LY</span>
              <span className="font-medium" style={{ color: pctChangeColor(data.salesToday, data.salesLastYearDay) }}>
                {pctChange(data.salesToday, data.salesLastYearDay)}
              </span>
            </div>
          )}
        </div>

        {/* === LAYER 4: Labor Gauge === */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LaborGauge percent={data.laborPercent} />
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground">Labor</span>
              {data.laborCost !== null && (
                <span className="text-xs font-semibold">{formatCurrency(data.laborCost)}</span>
              )}
            </div>
          </div>
          
          {/* Status tags */}
          <div className="flex flex-wrap gap-1 justify-end">
            {data.paceToday !== null && data.goalToday !== null && data.goalToday > 0 && (data.paceToday / data.goalToday) >= 1.1 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
                🔥 Beating Pace
              </span>
            )}
            {data.laborPercent !== null && data.laborPercent > 32 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-medium">
                ⚠️ Labor High
              </span>
            )}
          </div>
        </div>

        {/* === LAYER 5: Hourly Heatmap === */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9px] text-muted-foreground">Hourly Activity</span>
            <div className="flex gap-2 text-[8px] text-muted-foreground">
              <span>7a</span>
              <span>12p</span>
              <span>5p</span>
              <span>10p</span>
            </div>
          </div>
          <HourlyHeatmap data={data.hourlyData} />
        </div>
      </div>
    </Card>
  );
}

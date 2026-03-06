import { OrgLocationData } from '../OrgLocationCube';

// Shared utilities for all cube styles
export function getPaceStatus(pace: number | null, goal: number | null) {
  if (!pace || !goal || goal === 0) return { label: '', pct: 0, status: 'neutral' as const };
  const pct = (pace / goal) * 100;
  if (pct >= 110) return { label: 'On Fire', pct, status: 'fire' as const };
  if (pct >= 105) return { label: 'Ahead', pct, status: 'ahead' as const };
  if (pct >= 95) return { label: 'On Track', pct, status: 'track' as const };
  return { label: 'Behind', pct, status: 'behind' as const };
}

/** Derive a status color from any available comparison when pace/goal is missing */
export function deriveStatus(data: OrgLocationData): 'fire' | 'ahead' | 'track' | 'behind' | 'neutral' {
  // Primary: pace vs goal
  if (data.paceToday && data.goalToday && data.goalToday > 0) {
    const pct = (data.paceToday / data.goalToday) * 100;
    if (pct >= 110) return 'fire';
    if (pct >= 105) return 'ahead';
    if (pct >= 95) return 'track';
    return 'behind';
  }
  // Fallback: today vs last year same day
  if (data.salesToday > 100 && data.salesLastYearDay && data.salesLastYearDay > 0) {
    const pct = (data.salesToday / data.salesLastYearDay) * 100;
    if (pct >= 110) return 'fire';
    if (pct >= 100) return 'ahead';
    if (pct >= 85) return 'track';
    return 'behind';
  }
  // Fallback: WTD vs prev week
  if (data.salesWtd > 0 && data.salesPrevWeek && data.salesPrevWeek > 0) {
    const pct = (data.salesWtd / data.salesPrevWeek) * 100;
    if (pct >= 105) return 'ahead';
    if (pct >= 90) return 'track';
    return 'behind';
  }
  // Has sales but no comparisons yet
  if (data.salesToday > 100) return 'track';
  return 'neutral';
}

export const STATUS_COLORS = {
  fire: '#22c55e',
  ahead: '#22c55e',
  track: '#eab308',
  behind: '#ef4444',
  neutral: '#6b7280',
};

export function getLaborColor(pct: number | null): string {
  if (pct === null) return 'hsl(var(--muted-foreground))';
  if (pct < 28) return '#22c55e';
  if (pct <= 32) return '#eab308';
  return '#ef4444';
}

export function formatCurrency(val: number): string {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`;
  return `$${Math.round(val).toLocaleString()}`;
}

export function formatCurrencyFull(val: number): string {
  return `$${Math.round(val).toLocaleString()}`;
}

export function pctChange(current: number, prev: number | null): string {
  if (!prev || prev === 0) return '--';
  const pct = ((current - prev) / prev) * 100;
  const arrow = pct >= 0 ? '▲' : '▼';
  return `${arrow}${Math.abs(pct).toFixed(1)}%`;
}

export function pctChangeColor(current: number, prev: number | null): string {
  if (!prev || prev === 0) return 'hsl(var(--muted-foreground))';
  return current >= prev ? '#22c55e' : '#ef4444';
}

export function getDisplayName(data: OrgLocationData): string {
  return data.storeNumber ? `${data.locationName} - ${data.storeNumber}` : data.locationName;
}

// Sparkline SVG component
export function Sparkline({ data, color, height = 24 }: { data: number[]; color: string; height?: number }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100;
  const h = height;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  const gradId = `sg-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradId})`} points={`0,${h} ${points} ${w},${h}`} />
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

// Hourly heatmap component with optional hour labels under hot bars
export function HourlyHeatmap({ data, height = 16, variant = 'default', showLabels = false }: { data: number[]; height?: number; variant?: 'default' | 'light'; showLabels?: boolean }) {
  const max = Math.max(...data, 1);
  const businessHours = data.slice(7, 24); // index 0=7am ... 16=11pm

  const formatHour = (hourIdx: number) => {
    const hour = hourIdx + 7; // actual hour
    if (hour === 12) return '12p';
    if (hour > 12) return `${hour - 12}p`;
    return `${hour}a`;
  };

  return (
    <div>
      <div className="flex gap-[1px] items-end" style={{ height }}>
        {businessHours.map((val, i) => {
          const intensity = max > 0 ? val / max : 0;
          let bg: string;
          if (variant === 'light') {
            bg = intensity > 0.7 ? 'rgba(255,255,255,0.9)' 
              : intensity > 0.4 ? 'rgba(255,255,255,0.5)' 
              : intensity > 0.05 ? 'rgba(255,255,255,0.2)' 
              : 'rgba(255,255,255,0.08)';
          } else {
            bg = intensity > 0.7 ? '#22c55e' 
              : intensity > 0.4 ? '#eab308' 
              : intensity > 0.05 ? 'hsl(var(--muted-foreground)/0.3)' 
              : 'hsl(var(--muted))';
          }
          return (
            <div
              key={i}
              className="flex-1 min-w-[3px] rounded-[1px]"
              style={{ backgroundColor: bg, height: `${Math.max(15, intensity * 100)}%` }}
            />
          );
        })}
      </div>
      {showLabels && (
        <div className="flex gap-[1px]">
          {businessHours.map((val, i) => {
            const intensity = max > 0 ? val / max : 0;
            const isHot = intensity > 0.4;
            return (
              <div key={i} className="flex-1 min-w-[3px] text-center">
                {isHot ? (
                  <span className={`text-[10px] leading-tight font-bold ${variant === 'light' ? 'opacity-80' : 'text-muted-foreground'}`}>
                    {formatHour(i)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Labor gauge component
export function LaborGauge({ percent, size = 36 }: { percent: number | null; size?: number }) {
  const pct = percent ?? 0;
  const color = getLaborColor(percent);
  const radius = size * 0.39;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(pct / 40, 1);
  const offset = circumference * (1 - filled);
  const center = size / 2;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
        <circle cx={center} cy={center} r={radius} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span className="absolute text-[9px] font-bold" style={{ color }}>
        {percent !== null ? `${percent.toFixed(0)}%` : '--'}
      </span>
    </div>
  );
}

export interface CubeStyleProps {
  data: OrgLocationData;
  isLoading?: boolean;
  onClick?: () => void;
}

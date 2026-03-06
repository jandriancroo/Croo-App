import { Layout } from '@/components/Layout';
import { OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { deriveStatus, STATUS_COLORS, pctChange } from '@/components/org-dashboard/cube-styles/shared';
import { useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

// Mock data for preview
const MOCK_LOCATIONS: OrgLocationData[] = [
  {
    locationId: '1', locationName: 'Palm Springs', storeNumber: '1223',
    salesToday: 4334, paceToday: 5041, goalToday: 4879,
    last7Days: [5100, 4200, 3800, 5500, 4000, 4334, 0],
    salesWtd: 14125, salesPrevWeek: 29220,
    salesMtd: 18439, salesPrevMonth: 126257,
    salesLastYearDay: 4544, laborPercent: 19.6, laborCost: 848,
    laborCostWtd: 3122, laborCostMtd: 4076,
    hourlyData: [0,0,0,0,0,0,0,0,0,0,0,120,380,290,210,350,520,680,610,490,302,0,0,0],
  },
  {
    locationId: '2', locationName: 'Palm Desert', storeNumber: '1156',
    salesToday: 2812, paceToday: 3026, goalToday: 3400,
    last7Days: [3200, 2900, 2600, 3100, 2800, 2812, 0],
    salesWtd: 11511, salesPrevWeek: 22591,
    salesMtd: 14793, salesPrevMonth: 90991,
    salesLastYearDay: 3265, laborPercent: 23.6, laborCost: 663,
    laborCostWtd: 3870, laborCostMtd: 3862,
    hourlyData: [0,0,0,0,0,0,0,0,0,0,0,80,260,190,150,280,410,520,470,380,235,0,0,0],
  },
];

function fmtFull(val: number): string {
  return `$${Math.round(val).toLocaleString()}`;
}

function PeakHourHeatmap({ data, variant, maxBars }: { data: number[]; variant: string; maxBars?: number }) {
  const isMobile = useIsMobile();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const allHours = data.map((val, i) => ({ hour: i, val })).filter(h => h.val > 0);
  const count = maxBars ?? (isMobile ? 4 : 6);
  const top = [...allHours].sort((a, b) => b.val - a.val).slice(0, count).sort((a, b) => a.hour - b.hour);
  const max = Math.max(...top.map(h => h.val), 1);
  const formatHour = (hour: number) => {
    if (hour === 0) return '12a';
    if (hour === 12) return '12p';
    return hour > 12 ? `${hour - 12}p` : `${hour}a`;
  };
  if (top.length === 0) return null;

  const getBarColor = (intensity: number, isSelected: boolean) => {
    if (isSelected) return 'hsl(var(--primary))';
    if (variant === 'light') return intensity > 0.7 ? 'rgba(255,255,255,0.9)' : intensity > 0.4 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
    if (variant === 'muted') return intensity > 0.7 ? 'hsl(var(--primary))' : intensity > 0.4 ? 'hsl(var(--primary)/0.5)' : 'hsl(var(--muted))';
    if (variant === 'dark') return intensity > 0.7 ? 'rgba(255,255,255,0.85)' : intensity > 0.4 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.15)';
    return intensity > 0.7 ? 'hsl(var(--primary))' : intensity > 0.4 ? 'hsl(var(--primary)/0.5)' : 'hsl(var(--muted))';
  };

  return (
    <div>
      <div className="flex gap-[4px] items-end" style={{ height: 28 }}>
        {top.map((h, i) => {
          const intensity = max > 0 ? h.val / max : 0;
          const isSelected = selectedIdx === i;
          return (
            <div
              key={h.hour}
              className="flex-1 rounded-[3px] min-w-[14px] cursor-pointer transition-all"
              style={{
                backgroundColor: getBarColor(intensity, isSelected),
                height: `${Math.max(15, intensity * 100)}%`,
                opacity: selectedIdx !== null && !isSelected ? 0.4 : 1,
              }}
              onClick={(e) => { e.stopPropagation(); setSelectedIdx(prev => prev === i ? null : i); }}
            />
          );
        })}
      </div>
      <div className="flex gap-[4px]">
        {top.map((h, i) => {
          const isSelected = selectedIdx === i;
          return (
            <div key={h.hour} className="flex-1 text-center min-w-[14px]">
              {isSelected ? (
                <span className="text-[9px] font-black text-foreground">${h.val.toLocaleString()}</span>
              ) : (
                <span className={`text-[9px] font-bold ${variant === 'light' || variant === 'dark' ? 'opacity-70' : 'text-muted-foreground'}`}>{formatHour(h.hour)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STYLE A: Current (Status-Colored Gradient) ───
function StyleACurrent({ data }: { data: OrgLocationData }) {
  const derivedStatus = deriveStatus(data);
  const statusColor = STATUS_COLORS[derivedStatus];
  const STATUS_LABELS: Record<string, string> = { fire: 'On Fire', ahead: 'Ahead', track: 'On Track', behind: 'Behind' };
  const statusLabel = derivedStatus !== 'neutral' ? STATUS_LABELS[derivedStatus] : undefined;
  const goalPct = data.goalToday && data.goalToday > 0 ? Math.min((data.salesToday / data.goalToday) * 100, 120) : 0;
  const paceAboveGoal = data.paceToday !== null && data.goalToday !== null && data.goalToday > 0 ? data.paceToday >= data.goalToday : null;
  const laborPct = data.laborPercent;

  return (
    <div className="rounded-xl relative overflow-hidden" style={{ background: `linear-gradient(145deg, ${statusColor}dd, ${statusColor}99)`, color: 'white' }}>
      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10" />
      <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-black/10" />
      <div className="relative z-10 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold truncate drop-shadow-sm">{data.locationName}</p>
            <span className="text-xs font-semibold opacity-70">{data.storeNumber}</span>
            {statusLabel && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm">{statusLabel}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right"><p className="text-[8px] opacity-50">Goal</p><p className="text-xs font-black">{data.goalToday ? fmtFull(data.goalToday) : '—'}</p></div>
            <div className="text-right"><p className="text-[8px] opacity-50">Pace</p><p className="text-xs font-black">{data.paceToday ? fmtFull(data.paceToday) : '—'}</p></div>
            {paceAboveGoal !== null && <span className="text-lg font-black">{paceAboveGoal ? '▲' : '▼'}</span>}
            <p className="text-2xl font-black tracking-tighter">{fmtFull(data.salesToday)}</p>
          </div>
        </div>
        <div className="h-1.5 bg-black/20 rounded-full overflow-hidden"><div className="h-full bg-white/80 rounded-full" style={{ width: `${Math.min(goalPct, 100)}%` }} /></div>
        <p className="text-[9px] opacity-50">{goalPct.toFixed(0)}% of goal</p>
        <div className="flex items-stretch gap-2">
          <div className="flex-1 opacity-90"><PeakHourHeatmap data={data.hourlyData} variant="light" /></div>
          <div className="flex gap-1 shrink-0">
            {[
              { label: 'WTD', val: fmtFull(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
              { label: 'MTD', val: fmtFull(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
              { label: 'Labor', val: laborPct !== null ? `${laborPct.toFixed(0)}%` : '—', sub: data.laborCost ? fmtFull(data.laborCost) : '' },
            ].map(m => (
              <div key={m.label} className="bg-white/15 rounded-lg px-2 py-1.5 text-center backdrop-blur-sm min-w-[50px]">
                <p className="text-[8px] opacity-60">{m.label}</p>
                <p className="text-xs font-black">{m.val}</p>
                {m.sub && <p className="text-[9px] font-semibold opacity-80">{m.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── STYLE B: Neumorphic (matches app design system) ───
function StyleBNeumorphic({ data }: { data: OrgLocationData }) {
  const derivedStatus = deriveStatus(data);
  const STATUS_LABELS: Record<string, string> = { fire: 'On Fire', ahead: 'Ahead', track: 'On Track', behind: 'Behind' };
  const statusLabel = derivedStatus !== 'neutral' ? STATUS_LABELS[derivedStatus] : undefined;
  const statusColor = STATUS_COLORS[derivedStatus];
  const goalPct = data.goalToday && data.goalToday > 0 ? Math.min((data.salesToday / data.goalToday) * 100, 120) : 0;
  const paceAboveGoal = data.paceToday !== null && data.goalToday !== null && data.goalToday > 0 ? data.paceToday >= data.goalToday : null;
  const laborPct = data.laborPercent;

  return (
    <div className="rounded-2xl bg-card border border-border/50 shadow-[4px_4px_12px_hsl(var(--foreground)/0.06),-3px_-3px_10px_hsl(var(--background)/0.8)] relative overflow-hidden">
      {/* Left accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ backgroundColor: STATUS_COLORS[derivedStatus] }} />
      <div className="pl-5 pr-4 py-3 space-y-2">
        {/* Header - single row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-foreground leading-tight">{data.locationName}</p>
              {statusLabel && (
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                  derivedStatus === 'fire' || derivedStatus === 'ahead' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : derivedStatus === 'track' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}>{statusLabel}</span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground font-medium">{data.storeNumber}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right hidden md:block"><p className="text-[8px] text-muted-foreground">Goal</p><p className="text-xs font-bold text-foreground">{data.goalToday ? fmtFull(data.goalToday) : '—'}</p></div>
            <div className="text-right"><p className="text-[8px] text-muted-foreground">Pace</p><p className="text-xs font-bold text-foreground">{data.paceToday ? fmtFull(data.paceToday) : '—'}</p></div>
            {paceAboveGoal !== null && <span className={`text-lg font-black ${paceAboveGoal ? 'text-green-500' : 'text-red-500'}`}>{paceAboveGoal ? '▲' : '▼'}</span>}
            <p className="text-2xl font-black tracking-tighter text-foreground">{fmtFull(data.salesToday)}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-0.5">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(goalPct, 100)}%` }} />
          </div>
          <p className="text-[9px] text-muted-foreground">{goalPct.toFixed(0)}% of goal</p>
        </div>

        {/* Heatmap + Labor */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex-1"><PeakHourHeatmap data={data.hourlyData} variant="muted" /></div>
          <div className="shrink-0 text-right">
            <p className="text-[8px] text-muted-foreground">Labor</p>
            <p className="text-xl font-black text-foreground">{laborPct !== null ? `${laborPct.toFixed(0)}%` : '—'}</p>
            {data.laborCost !== null && <p className="text-[10px] text-muted-foreground font-medium">{fmtFull(data.laborCost)}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── STYLE C: Dark Glass ───
function StyleCDarkGlass({ data }: { data: OrgLocationData }) {
  const derivedStatus = deriveStatus(data);
  const STATUS_LABELS: Record<string, string> = { fire: 'On Fire', ahead: 'Ahead', track: 'On Track', behind: 'Behind' };
  const statusLabel = derivedStatus !== 'neutral' ? STATUS_LABELS[derivedStatus] : undefined;
  const statusColor = STATUS_COLORS[derivedStatus];
  const goalPct = data.goalToday && data.goalToday > 0 ? Math.min((data.salesToday / data.goalToday) * 100, 120) : 0;
  const paceAboveGoal = data.paceToday !== null && data.goalToday !== null && data.goalToday > 0 ? data.paceToday >= data.goalToday : null;
  const laborPct = data.laborPercent;

  return (
    <div className="rounded-2xl relative overflow-hidden" style={{ background: 'linear-gradient(145deg, hsl(220 20% 16%), hsl(220 18% 22%))', color: '#e2e8f0' }}>
      {/* Accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ backgroundColor: statusColor }} />
      <div className="px-4 pl-5 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold">{data.locationName}</p>
            <span className="text-xs opacity-50">{data.storeNumber}</span>
            {statusLabel && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor}30`, color: statusColor }}>{statusLabel}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right"><p className="text-[8px] opacity-40">Goal</p><p className="text-xs font-bold">{data.goalToday ? fmtFull(data.goalToday) : '—'}</p></div>
            <div className="text-right"><p className="text-[8px] opacity-40">Pace</p><p className="text-xs font-bold">{data.paceToday ? fmtFull(data.paceToday) : '—'}</p></div>
            {paceAboveGoal !== null && <span className="text-lg font-black" style={{ color: paceAboveGoal ? '#22c55e' : '#ef4444' }}>{paceAboveGoal ? '▲' : '▼'}</span>}
            <p className="text-2xl font-black tracking-tighter">{fmtFull(data.salesToday)}</p>
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(goalPct, 100)}%`, backgroundColor: statusColor }} />
          </div>
          <p className="text-[9px] opacity-40">{goalPct.toFixed(0)}% of goal</p>
        </div>
        <div className="flex items-stretch gap-2">
          <div className="flex-1"><PeakHourHeatmap data={data.hourlyData} variant="dark" /></div>
          <div className="flex gap-1 shrink-0">
            {[
              { label: 'WTD', val: fmtFull(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
              { label: 'MTD', val: fmtFull(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
              { label: 'Labor', val: laborPct !== null ? `${laborPct.toFixed(0)}%` : '—', sub: data.laborCost ? fmtFull(data.laborCost) : '' },
            ].map(m => (
              <div key={m.label} className="rounded-lg px-2 py-1.5 text-center min-w-[50px]" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <p className="text-[8px] opacity-40">{m.label}</p>
                <p className="text-xs font-black">{m.val}</p>
                {m.sub && <p className="text-[9px] font-semibold opacity-60">{m.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── STYLE D: Minimal Bordered ───
function StyleDMinimal({ data }: { data: OrgLocationData }) {
  const derivedStatus = deriveStatus(data);
  const STATUS_LABELS: Record<string, string> = { fire: 'On Fire', ahead: 'Ahead', track: 'On Track', behind: 'Behind' };
  const statusLabel = derivedStatus !== 'neutral' ? STATUS_LABELS[derivedStatus] : undefined;
  const statusColor = STATUS_COLORS[derivedStatus];
  const goalPct = data.goalToday && data.goalToday > 0 ? Math.min((data.salesToday / data.goalToday) * 100, 120) : 0;
  const paceAboveGoal = data.paceToday !== null && data.goalToday !== null && data.goalToday > 0 ? data.paceToday >= data.goalToday : null;
  const laborPct = data.laborPercent;

  return (
    <div className="rounded-xl bg-background border-2 border-border/80 hover:border-primary/30 transition-colors">
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-foreground">{data.locationName}</p>
            <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{data.storeNumber}</span>
            {statusLabel && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded border" style={{ borderColor: statusColor, color: statusColor }}>{statusLabel}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right"><p className="text-[8px] text-muted-foreground uppercase tracking-wide">Goal</p><p className="text-xs font-bold text-foreground">{data.goalToday ? fmtFull(data.goalToday) : '—'}</p></div>
            <div className="text-right"><p className="text-[8px] text-muted-foreground uppercase tracking-wide">Pace</p><p className="text-xs font-bold text-foreground">{data.paceToday ? fmtFull(data.paceToday) : '—'}</p></div>
            {paceAboveGoal !== null && <span className="text-lg font-black" style={{ color: paceAboveGoal ? '#22c55e' : '#ef4444' }}>{paceAboveGoal ? '▲' : '▼'}</span>}
            <p className="text-2xl font-black tracking-tighter text-foreground">{fmtFull(data.salesToday)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(goalPct, 100)}%`, backgroundColor: statusColor }} />
          </div>
          <p className="text-[9px] text-muted-foreground font-medium shrink-0">{goalPct.toFixed(0)}%</p>
        </div>
        <div className="flex items-stretch gap-3">
          <div className="flex-1"><PeakHourHeatmap data={data.hourlyData} variant="muted" /></div>
          <div className="flex gap-1.5 shrink-0">
            {[
              { label: 'WTD', val: fmtFull(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
              { label: 'MTD', val: fmtFull(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
              { label: 'Labor', val: laborPct !== null ? `${laborPct.toFixed(0)}%` : '—', sub: data.laborCost ? fmtFull(data.laborCost) : '' },
            ].map(m => (
              <div key={m.label} className="border border-border rounded-lg px-2.5 py-1.5 text-center min-w-[52px]">
                <p className="text-[8px] text-muted-foreground uppercase tracking-wide">{m.label}</p>
                <p className="text-xs font-black text-foreground">{m.val}</p>
                {m.sub && <p className="text-[9px] font-semibold text-muted-foreground">{m.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const STYLES = [
  { id: 'current', name: 'A: Current (Color Gradient)', Component: StyleACurrent },
  { id: 'neumorphic', name: 'B: Neumorphic (Match App)', Component: StyleBNeumorphic },
  { id: 'darkglass', name: 'C: Dark Glass', Component: StyleCDarkGlass },
  { id: 'minimal', name: 'D: Minimal Bordered', Component: StyleDMinimal },
];

export default function OrgDashStylePreview() {
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

  return (
    <Layout>
      <div className="space-y-6 pb-20">
        <div>
          <h1 className="text-xl font-bold">Org Card Style Preview</h1>
          <p className="text-sm text-muted-foreground mt-1">Same data & layout, different card styles. Pick your favorite.</p>
        </div>

        {STYLES.map(({ id, name, Component }) => (
          <div key={id} className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">{name}</h2>
              <button
                onClick={() => setSelectedStyle(prev => prev === id ? null : id)}
                className={`text-xs font-bold px-3 py-1 rounded-full transition-all ${
                  selectedStyle === id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {selectedStyle === id ? '✓ Selected' : 'Pick this'}
              </button>
            </div>
            <div className="space-y-2">
              {MOCK_LOCATIONS.map(loc => (
                <Component key={loc.locationId} data={loc} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}

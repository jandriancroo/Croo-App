import { motion, AnimatePresence } from 'framer-motion';
import {
  CubeStyleProps, getPaceStatus, deriveStatus, STATUS_COLORS,
  pctChange,
} from './shared';

export type OrgPeriod = 'day' | 'week' | 'month';

/** Format as full integer with commas, e.g. $4,823 */
function fmtFull(val: number): string {
  return `$${Math.round(val).toLocaleString()}`;
}

/** Daily bar chart for week/month views */
function DailyBarChart({ data, labels, variant = 'light' }: { data: number[]; labels?: string[]; variant?: 'default' | 'light' }) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex gap-[3px] items-end" style={{ height: 28 }}>
        {data.map((val, i) => {
          const intensity = max > 0 ? val / max : 0;
          const bg = variant === 'light'
            ? (intensity > 0.7 ? 'rgba(255,255,255,0.9)' : intensity > 0.4 ? 'rgba(255,255,255,0.5)' : intensity > 0.05 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)')
            : (intensity > 0.7 ? '#22c55e' : intensity > 0.4 ? '#eab308' : intensity > 0.05 ? 'hsl(var(--muted-foreground)/0.3)' : 'hsl(var(--muted))');
          return (
            <div key={i} className="flex-1 rounded-[2px]" style={{ backgroundColor: bg, height: `${Math.max(10, intensity * 100)}%`, minWidth: 8 }} />
          );
        })}
      </div>
      {labels && (
        <div className="flex gap-[3px]">
          {labels.map((label, i) => (
            <div key={i} className="flex-1 text-center">
              <span className={`text-[9px] font-bold ${variant === 'light' ? 'opacity-70' : 'text-muted-foreground'}`}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact heatmap showing only top 6 peak hours */
function PeakHourHeatmap({ data, variant = 'light' }: { data: number[]; variant?: 'default' | 'light' }) {
  const businessHours = data.slice(7, 23);
  const indexed = businessHours.map((val, i) => ({ hour: i + 7, val }));
  const top6 = [...indexed].sort((a, b) => b.val - a.val).slice(0, 6).sort((a, b) => a.hour - b.hour);
  const max = Math.max(...top6.map(h => h.val), 1);

  const formatHour = (hour: number) => {
    if (hour === 12) return '12p';
    return hour > 12 ? `${hour - 12}p` : `${hour}a`;
  };

  return (
    <div>
      <div className="flex gap-[4px] items-end" style={{ height: 28 }}>
        {top6.map(h => {
          const intensity = max > 0 ? h.val / max : 0;
          const bg = variant === 'light'
            ? (intensity > 0.7 ? 'rgba(255,255,255,0.9)' : intensity > 0.4 ? 'rgba(255,255,255,0.5)' : intensity > 0.05 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)')
            : (intensity > 0.7 ? '#22c55e' : intensity > 0.4 ? '#eab308' : intensity > 0.05 ? 'hsl(var(--muted-foreground)/0.3)' : 'hsl(var(--muted))');
          return <div key={h.hour} className="flex-1 rounded-[2px] min-w-[14px]" style={{ backgroundColor: bg, height: `${Math.max(15, intensity * 100)}%` }} />;
        })}
      </div>
      <div className="flex gap-[4px]">
        {top6.map(h => (
          <div key={h.hour} className="flex-1 text-center min-w-[14px]">
            <span className={`text-[9px] font-bold ${variant === 'light' ? 'opacity-70' : 'text-muted-foreground'}`}>{formatHour(h.hour)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const DAY_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface OrgCubeStyleBProps extends CubeStyleProps {
  period?: OrgPeriod;
  collapsed?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

/** Shared header row — identical in collapsed and expanded, mobile-responsive */
function HeaderRow({ data, period, paceAboveGoal, statusLabel }: {
  data: CubeStyleProps['data'];
  period: OrgPeriod;
  paceAboveGoal: boolean | null;
  statusLabel?: string;
}) {
  const heroSales = period === 'day' ? data.salesToday : period === 'week' ? data.salesWtd : data.salesMtd;
  const goalVal = period === 'day' ? data.goalToday : null;
  const paceVal = period === 'day' ? data.paceToday : null;

  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      {/* Left: Location name + store number + status badge */}
      <div className="flex items-center gap-1.5 min-w-0 shrink overflow-hidden">
        <p className="text-sm font-bold truncate drop-shadow-sm">{data.locationName}</p>
        {data.storeNumber && (
          <span className="text-xs font-semibold opacity-70 shrink-0">{data.storeNumber}</span>
        )}
        {statusLabel && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm shrink-0 hidden sm:inline-block">
            {statusLabel}
          </span>
        )}
      </div>

      {/* Right: Goal | Pace | arrow | Total */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {period === 'day' && (
          <>
            {/* Desktop: labeled columns */}
            <div className="text-right hidden sm:block">
              <p className="text-[8px] opacity-50 leading-none">Goal</p>
              <p className="text-xs font-black leading-tight">{goalVal !== null && goalVal > 0 ? fmtFull(goalVal) : '—'}</p>
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-[8px] opacity-50 leading-none">Pace</p>
              <p className="text-xs font-black leading-tight">{paceVal !== null && paceVal > 0 ? fmtFull(paceVal) : '—'}</p>
            </div>
            {/* Mobile: compact */}
            <div className="flex items-center gap-1.5 sm:hidden text-[10px] font-bold opacity-80">
              <span>{goalVal !== null && goalVal > 0 ? fmtFull(goalVal) : '—'}</span>
              <span className="opacity-40">/</span>
              <span>{paceVal !== null && paceVal > 0 ? fmtFull(paceVal) : '—'}</span>
            </div>
          </>
        )}
        {period === 'week' && (
          <div className="text-right">
            <p className="text-[8px] opacity-50 leading-none">Prev Wk</p>
            <p className="text-xs font-black leading-tight">{data.salesPrevWeek !== null ? fmtFull(data.salesPrevWeek) : '—'}</p>
          </div>
        )}
        {period === 'month' && (
          <div className="text-right">
            <p className="text-[8px] opacity-50 leading-none">Prev Mo</p>
            <p className="text-xs font-black leading-tight">{data.salesPrevMonth !== null ? fmtFull(data.salesPrevMonth) : '—'}</p>
          </div>
        )}
        {paceAboveGoal !== null && (
          <span className="text-sm md:text-lg font-black leading-none drop-shadow-sm">
            {paceAboveGoal ? '▲' : '▼'}
          </span>
        )}
        <p className="text-xl md:text-2xl font-black tracking-tighter leading-none drop-shadow-sm">
          {fmtFull(heroSales)}
        </p>
      </div>
    </div>
  );
}

/** Style B: Glass Scoreboard */
export function OrgCubeStyleB({ data, isLoading, onClick, period = 'day', collapsed = false, expanded = false, onToggleExpand }: OrgCubeStyleBProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  // Use deriveStatus for card colorization — falls back to YoY/WTD comparisons when no pace/goal
  const derivedStatus = deriveStatus(data);
  const statusColor = STATUS_COLORS[derivedStatus];

  // Arrow: use pace vs goal, then fallback to YoY or WTD comparisons
  const paceAboveGoal = period === 'day' && data.paceToday !== null && data.goalToday !== null && data.goalToday > 0
    ? data.paceToday >= data.goalToday
    : period === 'day' && data.salesToday > 100 && data.salesLastYearDay !== null && data.salesLastYearDay > 0
    ? data.salesToday >= data.salesLastYearDay
    : period === 'week' && data.salesPrevWeek !== null
    ? data.salesWtd >= data.salesPrevWeek
    : period === 'month' && data.salesPrevMonth !== null
    ? data.salesMtd >= data.salesPrevMonth
    : null;

  // Status label for badge
  const STATUS_LABELS: Record<string, string> = {
    fire: '🔥 On Fire', ahead: '📈 Ahead', track: '✅ On Track', behind: '⚠️ Behind',
  };
  const statusLabel = derivedStatus !== 'neutral' ? STATUS_LABELS[derivedStatus] : undefined;

  if (isLoading) {
    return (
      <div className={`rounded-xl animate-pulse bg-muted/30 ${collapsed ? 'h-10' : 'h-24'}`}>
        <div className="p-3 space-y-2">
          <div className="h-4 bg-muted rounded w-1/2" />
          {!collapsed && <div className="h-8 bg-muted rounded" />}
        </div>
      </div>
    );
  }

  const heroSales = period === 'day' ? data.salesToday : period === 'week' ? data.salesWtd : data.salesMtd;

  // Labor per period
  const laborCostForPeriod = period === 'day' ? data.laborCost
    : period === 'week' ? (data.laborCostWtd ?? data.laborCost)
    : (data.laborCostMtd ?? data.laborCost);
  const laborPctForPeriod = laborCostForPeriod !== null && heroSales > 0
    ? (laborCostForPeriod / heroSales) * 100 : null;

  const metricCubes = period === 'day' ? [
    { label: 'WTD', val: fmtFull(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'MTD', val: fmtFull(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'Labor', val: laborPctForPeriod !== null ? `${laborPctForPeriod.toFixed(0)}%` : '—', sub: laborCostForPeriod !== null ? fmtFull(laborCostForPeriod) : '' },
  ] : period === 'week' ? [
    { label: 'Prev Wk', val: data.salesPrevWeek !== null ? fmtFull(data.salesPrevWeek) : '—', sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'MTD', val: fmtFull(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'Labor', val: laborPctForPeriod !== null ? `${laborPctForPeriod.toFixed(0)}%` : '—', sub: laborCostForPeriod !== null ? fmtFull(laborCostForPeriod) : '' },
  ] : [
    { label: 'Prev Mo', val: data.salesPrevMonth !== null ? fmtFull(data.salesPrevMonth) : '—', sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'WTD', val: fmtFull(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'Labor', val: laborPctForPeriod !== null ? `${laborPctForPeriod.toFixed(0)}%` : '—', sub: laborCostForPeriod !== null ? fmtFull(laborCostForPeriod) : '' },
  ];

  const goalPct = period === 'day'
    ? (data.goalToday && data.goalToday > 0 ? Math.min((data.salesToday / data.goalToday) * 100, 120) : 0)
    : 0;
  const showPaceGoal = period === 'day';
  const compPrev = period === 'week' ? data.salesPrevWeek : period === 'month' ? data.salesPrevMonth : null;
  const compLabel = period === 'week' ? 'Prev Wk' : period === 'month' ? 'Prev Mo' : '';
  const heroLabel = period === 'day' ? 'Today' : period === 'week' ? 'WTD' : 'MTD';

  // Expanded body content — no duplicated pace/goal since header already shows it
  const expandedBody = (
    <div className="space-y-1.5 pt-1.5">
      {/* Progress bar for day view */}
      {showPaceGoal && (
        <div className="space-y-0.5">
          <div className="h-1.5 bg-black/20 rounded-full overflow-hidden">
            <div className="h-full bg-white/80 rounded-full transition-all" style={{ width: `${Math.min(goalPct, 100)}%` }} />
          </div>
          <p className="text-[9px] opacity-50">{goalPct.toFixed(0)}% of goal</p>
        </div>
      )}
      {/* Week/Month: comparison delta */}
      {!showPaceGoal && compPrev !== null && (
        <div className="text-[10px] font-bold opacity-80">
          {pctChange(heroSales, compPrev)} vs {compLabel.toLowerCase()}
        </div>
      )}

      {/* Graph + metric cubes */}
      <div className="flex items-stretch gap-2 md:gap-3">
        <div className="flex-1 flex flex-col justify-center opacity-90 min-w-0">
          {period === 'day' ? (
            <PeakHourHeatmap data={data.hourlyData} variant="light" />
          ) : (
            <DailyBarChart data={data.last7Days} labels={DAY_LABELS_SHORT} variant="light" />
          )}
        </div>
        <div className="flex gap-1 md:gap-1.5 shrink-0 items-center">
          {metricCubes.map(m => (
            <div key={m.label} className="bg-white/15 rounded-lg px-2 md:px-3 py-1.5 text-center backdrop-blur-sm min-w-[50px] md:min-w-[60px]">
              <p className="text-[8px] opacity-60">{m.label}</p>
              <p className="text-xs md:text-sm font-black leading-tight">{m.val}</p>
              {m.sub && <p className="text-[9px] font-semibold opacity-80">{m.sub}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const isExpanded = collapsed ? expanded : true;

  return (
    <div
      className="rounded-xl cursor-pointer hover:scale-[1.003] transition-all duration-200 relative overflow-hidden"
      onClick={collapsed ? onToggleExpand : onClick}
      style={{
        background: `linear-gradient(145deg, ${statusColor}dd, ${statusColor}99)`,
        color: 'white',
      }}
    >
      {isExpanded && (
        <>
          <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10" />
          <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-black/10" />
        </>
      )}

      <div className="relative z-10 px-3 md:px-4 py-2.5">
        <HeaderRow data={data} period={period} paceAboveGoal={paceAboveGoal} />

        {collapsed ? (
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
                {expandedBody}
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          expandedBody
        )}
      </div>
    </div>
  );
}

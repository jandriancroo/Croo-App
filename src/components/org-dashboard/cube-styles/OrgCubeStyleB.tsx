import { motion, AnimatePresence } from 'framer-motion';
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName,
  formatCurrency, formatCurrencyFull, pctChange,
  HourlyHeatmap,
} from './shared';

export type OrgPeriod = 'day' | 'week' | 'month';

/** Daily bar chart for week/month views */
function DailyBarChart({ data, labels, variant = 'light' }: { data: number[]; labels?: string[]; variant?: 'default' | 'light' }) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex gap-[3px] items-end" style={{ height: 28 }}>
        {data.map((val, i) => {
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
              className="flex-1 rounded-[2px]"
              style={{ backgroundColor: bg, height: `${Math.max(10, intensity * 100)}%`, minWidth: 8 }}
            />
          );
        })}
      </div>
      {labels && (
        <div className="flex gap-[3px]">
          {labels.map((label, i) => (
            <div key={i} className="flex-1 text-center">
              <span className={`text-[9px] font-bold ${variant === 'light' ? 'opacity-70' : 'text-muted-foreground'}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      )}
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

/** Collapsed ticker row — dense single-line with key metrics */
function CollapsedRow({ data, period = 'day', statusColor, pace, onClick }: {
  data: CubeStyleProps['data'];
  period: OrgPeriod;
  statusColor: string;
  pace: { label: string; pct: number; status: string };
  onClick?: () => void;
}) {
  const heroSales = period === 'day' ? data.salesToday
    : period === 'week' ? data.salesWtd
    : data.salesMtd;

  return (
    <div
      className="rounded-lg cursor-pointer hover:scale-[1.003] transition-all duration-150 relative overflow-hidden"
      onClick={onClick}
      style={{
        background: `linear-gradient(145deg, ${statusColor}cc, ${statusColor}88)`,
        color: 'white',
      }}
    >
      <div className="relative z-10 px-4 py-2 flex items-center justify-between gap-3">
        {/* Left: Name + status */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <p className="text-sm font-bold truncate drop-shadow-sm">{getDisplayName(data)}</p>
          <span className="text-[9px] font-bold bg-white/20 px-1.5 py-0.5 rounded-full shrink-0">
            {pace.label || '—'}
          </span>
        </div>

        {/* Right: Pace | Goal | Total */}
        <div className="flex items-center gap-4 shrink-0">
          {period === 'day' && (
            <>
              <div className="text-center">
                <p className="text-[8px] opacity-50 leading-none">Pace</p>
                <p className="text-sm font-black leading-tight">{data.paceToday !== null ? formatCurrency(data.paceToday) : '—'}</p>
              </div>
              <div className="text-center">
                <p className="text-[8px] opacity-50 leading-none">Goal</p>
                <p className="text-sm font-black leading-tight">{data.goalToday !== null ? formatCurrency(data.goalToday) : '—'}</p>
              </div>
            </>
          )}
          {period !== 'day' && (
            <div className="text-center">
              <p className="text-[8px] opacity-50 leading-none">{period === 'week' ? 'Prev Wk' : 'Prev Mo'}</p>
              <p className="text-sm font-black leading-tight">
                {(period === 'week' ? data.salesPrevWeek : data.salesPrevMonth) !== null
                  ? formatCurrency((period === 'week' ? data.salesPrevWeek : data.salesPrevMonth)!)
                  : '—'}
              </p>
            </div>
          )}
          <p className="text-2xl font-black tracking-tighter leading-none drop-shadow-sm">
            {formatCurrencyFull(heroSales)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Style B: Glass Scoreboard */
export function OrgCubeStyleB({ data, isLoading, onClick, period = 'day', collapsed = false, expanded = false, onToggleExpand }: OrgCubeStyleBProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];

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

  // In collapsed mode, show dense ticker unless this card is expanded
  if (collapsed && !expanded) {
    return (
      <CollapsedRow
        data={data}
        period={period}
        statusColor={statusColor}
        pace={pace}
        onClick={onToggleExpand}
      />
    );
  }

  // Derived values per period
  const heroSales = period === 'day' ? data.salesToday
    : period === 'week' ? data.salesWtd
    : data.salesMtd;

  const heroLabel = period === 'day' ? 'Today'
    : period === 'week' ? 'WTD'
    : 'MTD';

  const goalPct = period === 'day'
    ? (data.goalToday && data.goalToday > 0 ? Math.min((data.salesToday / data.goalToday) * 100, 120) : 0)
    : 0;

  const showPaceGoal = period === 'day';
  const compPrev = period === 'week' ? data.salesPrevWeek
    : period === 'month' ? data.salesPrevMonth
    : null;
  const compLabel = period === 'week' ? 'Prev Wk'
    : period === 'month' ? 'Prev Mo'
    : '';

  // Labor per period
  const laborCostForPeriod = period === 'day' ? data.laborCost
    : period === 'week' ? (data.laborCostWtd ?? data.laborCost)
    : (data.laborCostMtd ?? data.laborCost);

  const laborSalesForPeriod = period === 'day' ? data.salesToday
    : period === 'week' ? data.salesWtd
    : data.salesMtd;

  const laborPctForPeriod = laborCostForPeriod !== null && laborSalesForPeriod > 0
    ? (laborCostForPeriod / laborSalesForPeriod) * 100
    : null;

  const metricCubes = period === 'day' ? [
    { label: 'WTD', val: formatCurrency(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'MTD', val: formatCurrency(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'Labor', val: laborPctForPeriod !== null ? `${laborPctForPeriod.toFixed(0)}%` : '—', sub: laborCostForPeriod !== null ? formatCurrency(laborCostForPeriod) : '' },
  ] : period === 'week' ? [
    { label: 'Prev Wk', val: data.salesPrevWeek !== null ? formatCurrency(data.salesPrevWeek) : '—', sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'MTD', val: formatCurrency(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'Labor', val: laborPctForPeriod !== null ? `${laborPctForPeriod.toFixed(0)}%` : '—', sub: laborCostForPeriod !== null ? formatCurrency(laborCostForPeriod) : '' },
  ] : [
    { label: 'Prev Mo', val: data.salesPrevMonth !== null ? formatCurrency(data.salesPrevMonth) : '—', sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'WTD', val: formatCurrency(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'Labor', val: laborPctForPeriod !== null ? `${laborPctForPeriod.toFixed(0)}%` : '—', sub: laborCostForPeriod !== null ? formatCurrency(laborCostForPeriod) : '' },
  ];

  const fullContent = (
    <div
      className="rounded-xl cursor-pointer hover:scale-[1.005] transition-all duration-200 relative overflow-hidden"
      onClick={collapsed ? onToggleExpand : onClick}
      style={{
        background: `linear-gradient(145deg, ${statusColor}dd, ${statusColor}99)`,
        color: 'white',
      }}
    >
      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10" />
      <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-black/10" />

      <div className="relative z-10 px-4 py-2.5 space-y-1.5">
        {/* Row 1: Name + status + hero number */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <p className="text-base font-bold truncate drop-shadow-sm">{getDisplayName(data)}</p>
            <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full shrink-0">
              {pace.label || '—'}
            </span>
          </div>
          <p className="text-3xl font-black tracking-tighter leading-none drop-shadow-sm shrink-0">
            {formatCurrencyFull(heroSales)}
          </p>
        </div>

        {/* Row 2 */}
        <div className="flex items-stretch gap-3">
          <div className="shrink-0 space-y-1" style={{ minWidth: '140px' }}>
            {showPaceGoal ? (
              <>
                <div className="flex items-baseline gap-3">
                  <div>
                    <p className="text-[9px] opacity-60">Pace</p>
                    <p className="text-lg font-black leading-tight">{data.paceToday !== null ? formatCurrency(data.paceToday) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] opacity-60">Goal</p>
                    <p className="text-lg font-black leading-tight">{data.goalToday !== null ? formatCurrency(data.goalToday) : '—'}</p>
                  </div>
                </div>
                <div className="h-1.5 bg-black/20 rounded-full overflow-hidden">
                  <div className="h-full bg-white/80 rounded-full transition-all" style={{ width: `${Math.min(goalPct, 100)}%` }} />
                </div>
                <p className="text-[9px] opacity-50">{goalPct.toFixed(0)}% of goal</p>
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-3">
                  <div>
                    <p className="text-[9px] opacity-60">{heroLabel}</p>
                    <p className="text-lg font-black leading-tight">{formatCurrency(heroSales)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] opacity-60">{compLabel}</p>
                    <p className="text-lg font-black leading-tight">{compPrev !== null ? formatCurrency(compPrev) : '—'}</p>
                  </div>
                </div>
                <div className="text-[10px] font-bold opacity-80">
                  {compPrev !== null ? pctChange(heroSales, compPrev) : '—'} vs {compLabel.toLowerCase()}
                </div>
              </>
            )}
          </div>

          <div className="flex-1 flex flex-col justify-center opacity-90">
            {period === 'day' ? (
              <HourlyHeatmap data={data.hourlyData} height={28} variant="light" showLabels />
            ) : (
              <DailyBarChart data={data.last7Days} labels={DAY_LABELS_SHORT} variant="light" />
            )}
          </div>

          <div className="flex gap-1.5 shrink-0 items-center">
            {metricCubes.map(m => (
              <div key={m.label} className="bg-white/15 rounded-lg px-3 py-1.5 text-center backdrop-blur-sm min-w-[60px]">
                <p className="text-[8px] opacity-60">{m.label}</p>
                <p className="text-sm font-black leading-tight">{m.val}</p>
                {m.sub && <p className="text-[9px] font-semibold opacity-80">{m.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // If in collapsed accordion mode and this is the expanded card, animate it
  if (collapsed && expanded) {
    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
      >
        {fullContent}
      </motion.div>
    );
  }

  return fullContent;
}

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  CubeStyleProps, deriveStatus, STATUS_COLORS,
  pctChange,
} from './shared';

export type OrgPeriod = 'day' | 'week' | 'month';

function fmtFull(val: number): string {
  return `$${Math.round(val).toLocaleString()}`;
}

/** Daily bar chart for week/month views */
function DailyBarChart({ data, labels }: { data: number[]; labels?: string[] }) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex gap-[3px] items-end" style={{ height: 28 }}>
        {data.map((val, i) => {
          const intensity = max > 0 ? val / max : 0;
          const bg = intensity > 0.7 ? 'hsl(var(--primary))' : intensity > 0.4 ? 'hsl(var(--primary)/0.5)' : 'hsl(var(--muted))';
          return (
            <div key={i} className="flex-1 rounded-[2px]" style={{ backgroundColor: bg, height: `${Math.max(10, intensity * 100)}%`, minWidth: 8 }} />
          );
        })}
      </div>
      {labels && (
        <div className="flex gap-[3px]">
          {labels.map((label, i) => (
            <div key={i} className="flex-1 text-center">
              <span className="text-[9px] font-bold text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tap-to-reveal peak hour heatmap */
function PeakHourHeatmap({ data }: { data: number[] }) {
  const isMobile = useIsMobile();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const allHours = data.map((val, i) => ({ hour: i, val })).filter(h => h.val > 0);
  const count = isMobile ? 4 : 6;
  const top = [...allHours].sort((a, b) => b.val - a.val).slice(0, count).sort((a, b) => a.hour - b.hour);
  const max = Math.max(...top.map(h => h.val), 1);

  const formatHour = (hour: number) => {
    if (hour === 0) return '12a';
    if (hour === 12) return '12p';
    return hour > 12 ? `${hour - 12}p` : `${hour}a`;
  };

  if (top.length === 0) return null;

  return (
    <div>
      <div className="flex gap-[4px] items-end" style={{ height: 28 }}>
        {top.map((h, i) => {
          const intensity = max > 0 ? h.val / max : 0;
          const isSelected = selectedIdx === i;
          const bg = isSelected
            ? 'hsl(var(--primary))'
            : intensity > 0.7 ? 'hsl(var(--primary))' : intensity > 0.4 ? 'hsl(var(--primary)/0.5)' : 'hsl(var(--muted))';
          return (
            <div
              key={h.hour}
              className="flex-1 rounded-[3px] min-w-[14px] cursor-pointer transition-all"
              style={{
                backgroundColor: bg,
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
                <span className="text-[9px] font-bold text-muted-foreground">{formatHour(h.hour)}</span>
              )}
            </div>
          );
        })}
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

export function OrgCubeStyleB({ data, isLoading, onClick, period = 'day', collapsed = false, expanded = false, onToggleExpand }: OrgCubeStyleBProps) {
  const derivedStatus = deriveStatus(data);
  const statusColor = STATUS_COLORS[derivedStatus];

  const paceAboveGoal = period === 'day' && data.paceToday !== null && data.goalToday !== null && data.goalToday > 0
    ? data.paceToday >= data.goalToday
    : period === 'day' && data.salesToday > 100 && data.salesLastYearDay !== null && data.salesLastYearDay > 0
    ? data.salesToday >= data.salesLastYearDay
    : period === 'week' && data.salesPrevWeek !== null
    ? data.salesWtd >= data.salesPrevWeek
    : period === 'month' && data.salesPrevMonth !== null
    ? data.salesMtd >= data.salesPrevMonth
    : null;

  const STATUS_LABELS: Record<string, string> = {
    fire: 'On Fire', ahead: 'Ahead', track: 'On Track', behind: 'Behind',
  };
  const statusLabel = derivedStatus !== 'neutral' ? STATUS_LABELS[derivedStatus] : undefined;
  const statusBadgeClass = derivedStatus === 'fire' || derivedStatus === 'ahead'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : derivedStatus === 'track'
    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';

  if (isLoading) {
    return (
      <div className={`rounded-2xl animate-pulse bg-muted/30 ${collapsed ? 'h-10' : 'h-24'}`}>
        <div className="p-3 space-y-2">
          <div className="h-4 bg-muted rounded w-1/2" />
          {!collapsed && <div className="h-8 bg-muted rounded" />}
        </div>
      </div>
    );
  }

  const heroSales = period === 'day' ? data.salesToday : period === 'week' ? data.salesWtd : data.salesMtd;
  const goalVal = period === 'day' ? data.goalToday : null;
  const paceVal = period === 'day' ? data.paceToday : null;

  const laborCostForPeriod = period === 'day' ? data.laborCost
    : period === 'week' ? (data.laborCostWtd ?? data.laborCost)
    : (data.laborCostMtd ?? data.laborCost);
  const laborPctForPeriod = laborCostForPeriod !== null && heroSales > 0
    ? (laborCostForPeriod / heroSales) * 100 : null;

  const goalPct = period === 'day'
    ? (data.goalToday && data.goalToday > 0 ? Math.min((data.salesToday / data.goalToday) * 100, 120) : 0)
    : 0;

  const compPrev = period === 'week' ? data.salesPrevWeek : period === 'month' ? data.salesPrevMonth : null;
  const compLabel = period === 'week' ? 'Prev Wk' : period === 'month' ? 'Prev Mo' : '';

  const isExpanded = collapsed ? expanded : true;

  const expandedBody = (
    <div className="space-y-1.5 pt-1.5">
      {/* Progress bar for day view */}
      {period === 'day' && (
        <div className="space-y-0.5">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(goalPct, 100)}%` }} />
          </div>
          <p className="text-[9px] text-muted-foreground">{goalPct.toFixed(0)}% of goal</p>
        </div>
      )}
      {/* Week/Month comparison */}
      {period !== 'day' && compPrev !== null && (
        <div className="text-[10px] font-bold text-muted-foreground">
          {pctChange(heroSales, compPrev)} vs {compLabel.toLowerCase()}
        </div>
      )}

      {/* Heatmap + Labor */}
      <div className="flex items-end justify-between gap-3">
        <div className="flex-1">
          {period === 'day' ? (
            <PeakHourHeatmap data={data.hourlyData} />
          ) : (
            <DailyBarChart data={data.last7Days} labels={DAY_LABELS_SHORT} />
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[8px] text-muted-foreground">Labor</p>
          <p className="text-xl font-black text-foreground">{laborPctForPeriod !== null ? `${laborPctForPeriod.toFixed(0)}%` : '—'}</p>
          {laborCostForPeriod !== null && <p className="text-[10px] text-muted-foreground font-medium">{fmtFull(laborCostForPeriod)}</p>}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="rounded-2xl bg-card border border-border/50 shadow-[4px_4px_12px_hsl(var(--foreground)/0.06),-3px_-3px_10px_hsl(var(--background)/0.8)] relative overflow-hidden cursor-pointer hover:scale-[1.003] transition-all duration-200"
      onClick={collapsed ? onToggleExpand : onClick}
    >
      {/* Left accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ backgroundColor: statusColor }} />

      <div className="pl-5 pr-4 py-2.5">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-foreground leading-tight truncate">{data.locationName}</p>
              {statusLabel && (
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${statusBadgeClass}`}>{statusLabel}</span>
              )}
            </div>
            {data.storeNumber && <span className="text-[10px] text-muted-foreground font-medium">{data.storeNumber}</span>}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {period === 'day' && (
              <>
                <div className="text-right hidden md:block">
                  <p className="text-[8px] text-muted-foreground">Goal</p>
                  <p className="text-xs font-bold text-foreground">{goalVal ? fmtFull(goalVal) : '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] text-muted-foreground">Pace</p>
                  <p className="text-xs font-bold text-foreground">{paceVal ? fmtFull(paceVal) : '—'}</p>
                </div>
              </>
            )}
            {period === 'week' && (
              <div className="text-right">
                <p className="text-[8px] text-muted-foreground">Prev Wk</p>
                <p className="text-xs font-bold text-foreground">{data.salesPrevWeek !== null ? fmtFull(data.salesPrevWeek) : '—'}</p>
              </div>
            )}
            {period === 'month' && (
              <div className="text-right">
                <p className="text-[8px] text-muted-foreground">Prev Mo</p>
                <p className="text-xs font-bold text-foreground">{data.salesPrevMonth !== null ? fmtFull(data.salesPrevMonth) : '—'}</p>
              </div>
            )}
            {paceAboveGoal !== null && (
              <span className={`text-lg font-black ${paceAboveGoal ? 'text-green-500' : 'text-red-500'}`}>
                {paceAboveGoal ? '▲' : '▼'}
              </span>
            )}
            <p className="text-2xl font-black tracking-tighter text-foreground">{fmtFull(heroSales)}</p>
          </div>
        </div>

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

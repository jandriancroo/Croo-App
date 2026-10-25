import { Card } from '@/components/ui/card';
import type { ReactNode } from 'react';

const money = (v: number | null) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`);

interface Props {
  salesSoFar: number | null;
  projection: number | null;
  pace: number | null;
  laborPct: number | null;
  behind: boolean;
  caption: ReactNode;
  large?: boolean;
}

/** Half-circle "Tonight" gauge: sales so far vs tonight's projection. */
export function TonightGauge({ salesSoFar, projection, pace, laborPct, behind, caption, large }: Props) {
  const ratio = salesSoFar != null && projection ? Math.max(0, Math.min(1, salesSoFar / projection)) : 0;
  const r = 80;
  const len = Math.PI * r;
  const arc = `M 20 100 A ${r} ${r} 0 0 1 180 100`;
  const sideNum = large ? 'text-xl' : 'text-lg';

  return (
    <Card className="rounded-2xl p-4 border-border/60 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tonight</span>
        {projection != null && salesSoFar != null && (
          <span className="text-xs font-semibold text-muted-foreground">{Math.round(ratio * 100)}% of projection</span>
        )}
      </div>
      <div className={`grid items-end gap-2 grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,1fr)] ${large ? 'mt-2' : 'mt-1'}`}>
        <div className="text-left pb-2">
          <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">Pace</div>
          <div className={`${sideNum} font-bold tabular-nums text-foreground`}>{money(pace)}</div>
        </div>
        <div className={`relative w-full`}>
          <svg viewBox="0 0 200 110" className="w-full h-auto" aria-hidden="true">
            <path d={arc} fill="none" stroke="hsl(var(--muted))" strokeWidth="16" strokeLinecap="round" />
            <path
              d={arc}
              fill="none"
              stroke={behind ? 'hsl(var(--warning))' : 'hsl(var(--primary))'}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={`${len * ratio} ${len}`}
            />
          </svg>
          <div className="absolute inset-x-0 bottom-0 text-center">
            <div className={`${large ? 'text-5xl' : 'text-4xl'} font-black tabular-nums leading-none ${behind ? 'text-warning' : 'text-foreground'}`}>
              {laborPct != null ? `${laborPct.toFixed(1)}%` : '—'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">projected labor</div>
          </div>
        </div>
        <div className="text-right pb-2">
          <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">Projection</div>
          <div className={`${sideNum} font-bold tabular-nums text-foreground`}>{money(projection)}</div>
        </div>
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{money(salesSoFar)} so far</span>
        <span>{money(projection)}</span>
      </div>
      {caption && <p className={`${large ? 'text-base' : 'text-sm'} leading-snug text-foreground/80 mt-3`}>{caption}</p>}
    </Card>
  );
}

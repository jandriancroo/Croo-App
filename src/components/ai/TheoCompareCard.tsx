// Theo Dashboards: read-only comparison table card (chat thread and voice overlay).
// Same chrome as Theo's action approval card. Rendered ONLY from the structured
// compare_metrics payload; every value is plain text (no HTML, no markdown).
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { changeTone, formatCompareChange, formatComparePct, formatCompareValue, type CompareRow, type ComparePayload } from '@/lib/theoCompare';

function Row({ r, sub }: { r: CompareRow; sub?: boolean }) {
  const tone = changeTone(r);
  const pct = formatComparePct(r);
  return (
    <div className={cn('grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-2 py-1.5', sub ? 'text-[13px]' : 'text-[14px]')}>
      <div className="min-w-0">
        <div className={cn('truncate', sub ? 'font-medium' : 'font-semibold')} title={r.label}>{r.label}</div>
        {(r.a_units != null || r.b_units != null) && (
          <div className="truncate text-[11px] text-muted-foreground">{r.a_units == null ? '—' : Math.round(r.a_units).toLocaleString('en-US')} vs {r.b_units == null ? '—' : Math.round(r.b_units).toLocaleString('en-US')} sold</div>
        )}
        {r.note && <div className="text-[11px] leading-snug text-muted-foreground">{r.note}</div>}
      </div>
      <div className="text-right font-semibold">{formatCompareValue(r.a, r.unit, r.key)}</div>
      <div className="text-right text-muted-foreground">{formatCompareValue(r.b, r.unit, r.key)}</div>
      <div className={cn('text-right font-semibold', tone === 'up' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'down' ? 'text-destructive' : 'text-muted-foreground')}>
        <div>{formatCompareChange(r)}</div>
        {pct && <div className="text-[11px] font-medium">{pct}</div>}
      </div>
    </div>
  );
}

export function TheoCompareCard({ data, onClose, className }: { data: ComparePayload; onClose?: () => void; className?: string }) {
  return (
    <div data-testid="theo-compare-card" className={cn('w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-3 tabular-nums', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[18px] font-extrabold leading-tight">{data.title}</div>
          <div className="text-[13px] text-muted-foreground">{data.store_name}{data.store_name ? ' · ' : ''}{data.period_a.label} vs {data.period_b.label}</div>
          <div className="text-[12px] text-muted-foreground">{data.period_a.range} vs {data.period_b.range}</div>
        </div>
        {onClose && (
          <button type="button" aria-label="Close comparison" onClick={onClose} className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="max-h-[46vh] overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <div />
          <div className="truncate text-right" title={data.period_a.label}>{data.period_a.label.replace(/ \(to date\)$/, '')}</div>
          <div className="truncate text-right" title={data.period_b.label}>{data.period_b.label.replace(/ \(same days\)$/, '')}</div>
          <div className="text-right">Change</div>
        </div>
        {data.rows.length > 0 && (
          <div className="divide-y divide-border/60">
            {data.rows.map((r) => <Row key={r.key} r={r} />)}
          </div>
        )}
        {data.groups.map((g) => (
          <div key={g.key} className="mt-3">
            <div className="text-[13px] font-bold">{g.title}</div>
            {g.hidden_reason ? (
              <p className="mt-1 text-[13px] text-muted-foreground">{g.hidden_reason}</p>
            ) : (
              <div className="divide-y divide-border/60">
                {g.header && <Row r={g.header} />}
                {g.rows.map((r) => <Row key={r.key} r={r} sub />)}
                {!g.rows.length && !g.header && <p className="py-1.5 text-[13px] text-muted-foreground">No data for these periods.</p>}
              </div>
            )}
            {g.note && <p className="mt-1 text-[12px] text-muted-foreground">{g.note}</p>}
          </div>
        ))}
      </div>
      {(data.notes.length > 0 || data.footnote) && (
        <div className="flex flex-col gap-0.5 text-[12px] leading-snug text-muted-foreground">
          {data.notes.map((n, i) => <p key={i}>{n}</p>)}
          {data.footnote && <p>{data.footnote}</p>}
        </div>
      )}
    </div>
  );
}

// Kept as a string so the shipped bundle can be checked for the card.
TheoCompareCard.displayName = 'TheoCompareCard';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const PERIODS = ['Today', 'Yesterday', 'Week', 'Month'];

/** Duo sales summary: one centered pill — back / label (opens period picker) / forward. */
export function DuoSummary({ period, label, onPeriod, onPrev, onNext, nextDisabled, chart, stats, children }: {
  period: string; label: string; chart?: ReactNode; stats?: { label: string; value: string }[][]; onPeriod: (p: string) => void; onPrev: () => void; onNext: () => void;
  nextDisabled?: boolean; children: ReactNode;
}) {
  return <section className="duo-sales-summary">
    <div className="duo-period-pill duo-glass">
      <Button variant="ghost" aria-label="Previous" onClick={onPrev}><ChevronLeft size={18} /></Button>
      <Popover>
        <PopoverTrigger asChild><Button variant="ghost" className="duo-period-label" aria-label="Choose period">{label}<ChevronDown size={14} /></Button></PopoverTrigger>
        <PopoverContent className="duo-period-menu duo-glass" align="center">
          {PERIODS.map(p => <Button key={p} variant="ghost" className={p.toLowerCase() === period ? 'duo-selected' : ''}
            onClick={() => onPeriod(p.toLowerCase())}>{p}</Button>)}
        </PopoverContent>
      </Popover>
      <Button variant="ghost" aria-label="Next" disabled={nextDisabled} onClick={onNext}><ChevronRight size={18} /></Button>
    </div>
    <div className="duo-scoreboard">{children}</div>
    {stats?.map((row, i) => <div key={i} className="duo-stat-row">{row.map(t => <div key={t.label}><b>{t.value}</b><small>{t.label}</small></div>)}</div>)}
    {chart}</section>;
}

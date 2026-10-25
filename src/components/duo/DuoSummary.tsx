import type { ReactNode } from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';

export function DuoSummary({ period, onPeriod, children }: { period: string; onPeriod: (p: string) => void; children: ReactNode }) {
  return <section className="duo-sales-summary"><SegmentedControl value={period} onValueChange={onPeriod}
    aria-label="Sales period" options={['Today', 'Yesterday', 'Week', 'Month'].map(label => ({ label, value: label.toLowerCase() }))} />
    <div className="duo-scoreboard">{children}</div></section>;
}
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TheoCompareCard } from './TheoCompareCard';
import { readComparePayload, formatCompareChange, formatCompareValue } from '@/lib/theoCompare';

const raw = {
  kind: 'theo_compare', version: 1, title: 'Comparison', store_name: 'Hayward',
  period_a: { label: 'This week (to date)', start: '2026-11-09', end: '2026-11-14', range: 'Nov 9–14' },
  period_b: { label: 'Last week (same days)', start: '2026-11-02', end: '2026-11-07', range: 'Nov 2–7' },
  rows: [
    { key: 'net_sales', label: 'Net sales', unit: 'usd', a: 1100, b: 1000, change: 100, change_pct: 10 },
    { key: 'gross_sales', label: 'Gross sales', unit: 'usd', a: null, b: 1200, change: null, change_pct: null, note: 'Gross is missing a piece on 1 of 6 days.' },
    { key: 'labor_pct', label: 'Labor %', unit: 'pct', a: 22, b: 23.5, change: -1.5, change_pct: null },
    { key: 'labor_cost', label: 'Labor $', unit: 'usd', a: 500, b: 400, change: 100, change_pct: 25 },
  ],
  groups: [{ key: 'product_mix', title: 'Product mix', unit: 'usd', rows: [{ key: 'item:<img src=x onerror=alert(1)>', label: '<img src=x onerror=alert(1)>', unit: 'usd', a: 30, b: 20, change: 10, change_pct: 50, a_units: 3, b_units: 2 }] }],
  notes: ['**bold** _not markdown_'], footnote: 'Gross = net + discounts, comps, promos and refunds. Tax and tips excluded.', spoken_summary: 'Net sales were up.',
};

describe('readComparePayload', () => {
  it('rejects non-compare values and strips labor dollars', () => {
    expect(readComparePayload(null)).toBeNull();
    expect(readComparePayload({ kind: 'other' })).toBeNull();
    const p = readComparePayload(raw)!;
    expect(p.rows.map((r) => r.key)).toEqual(['net_sales', 'gross_sales', 'labor_pct']);
  });
});

describe('formatting', () => {
  it('uses DataCube-style formats and points for labor %', () => {
    expect(formatCompareValue(1234.4, 'usd')).toBe('$1,234');
    expect(formatCompareValue(21.456, 'usd', 'avg_ticket')).toBe('$21.46');
    expect(formatCompareValue(null, 'usd')).toBe('—');
    expect(formatCompareChange({ key: 'labor_pct', label: '', unit: 'pct', a: 22, b: 23.5, change: -1.5, change_pct: null })).toBe('−1.5 pts');
  });
});

describe('TheoCompareCard', () => {
  it('renders rows, — for hidden gross, and model/DB text as plain text only', () => {
    const { container } = render(<TheoCompareCard data={readComparePayload(raw)!} />);
    expect(screen.getByText('Net sales')).toBeTruthy();
    expect(screen.getByText('$1,100')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('**bold** _not markdown_')).toBeTruthy();
    expect(container.querySelector('strong, em')).toBeNull();
    expect(screen.queryByText('Labor $')).toBeNull();
  });
});

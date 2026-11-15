import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { periodSalesTotals, laborPercentOnNet, periodChange } from './periodTotals';

const root = path.resolve(__dirname, '../../..');

describe('reports periodTotals browser/edge copies', () => {
  it('periodTotals.ts is byte-identical (Reports and Theo compare_metrics share one path)', () => {
    const a = readFileSync(path.join(root, 'src/lib/reports/periodTotals.ts'));
    const b = readFileSync(path.join(root, 'supabase/functions/_shared/reports/periodTotals.ts'));
    expect(a.equals(b)).toBe(true);
  });
  it('keeps the Reports gross hide rule and labor % on net', () => {
    expect(periodSalesTotals([{ net_sales: 100, gross_sales: 110 }, { net_sales: 50, gross_sales: null }, { net_sales: 0, gross_sales: null }]))
      .toEqual({ net: 150, guests: 0, gross: null, grossDays: 1, salesDays: 2, rowDays: 3 });
    expect(periodSalesTotals([{ net_sales: 100, gross_sales: 110, guest_count: 4 }]).gross).toBe(110);
    expect(laborPercentOnNet(25, 100)).toBe(25);
    expect(periodChange(110, 100)).toEqual({ change: 10, percent: 10 });
    expect(periodChange(null, 100)).toEqual({ change: null, percent: null });
  });
});

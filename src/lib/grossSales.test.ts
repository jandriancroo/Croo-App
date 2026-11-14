import { describe, expect, it } from 'vitest';
import {
  GROSS_FOOTNOTE, grossForDay, grossForHour, hourKey24, localShowGrossKey, parseGrossPeriods,
  readLocalShowGross, readShowGrossPref, visibleGross,
} from './grossSales';
import { resolveWatchMetricValue } from '@/utils/watchMetrics';
import { METRIC_CONFIGS, METRIC_GROUPS, grossMetricValue, type SalesDataForWidgets } from '@/components/dashboard/DashboardWidget';
import { periodMetrics, comparison } from '../../supabase/functions/_shared/periodMetrics';
import { toastOfficialGross, hourlyGrossFromDiscounts, mergeHourlyGross, posExtrasPatch } from '../../supabase/functions/_shared/posExtras';
import { formatHourlyTo24 } from '../../supabase/functions/_shared/hourly';

const periods = parseGrossPeriods([{
  day_gross: 1300, yday_gross: null, wtd_gross: 5200, mtd_gross: 9100, lw_day_gross: 1250, lw_wtd_gross: 5000,
  lm_mtd_gross: 8800, ly_date: '2025-11-14', ly_day_gross: 1100, ly_week_gross: 7000, ly_month_gross: 30000,
  days: { '2026-11-10': 1200 }, day_hourly: { '13:00': 260, '14:00': '140.5' },
}])!;

describe('gross toggle defaults to net only', () => {
  it('is OFF with no saved preference anywhere', () => {
    expect(readLocalShowGross({ getItem: () => null }, 'u1')).toBe(false);
    expect(readLocalShowGross(null, null)).toBe(false);
    expect(readShowGrossPref({})).toBeNull();
    expect(readShowGrossPref(null)).toBeNull();
  });
  it('reads a saved per-user choice', () => {
    expect(readShowGrossPref({ show_gross_sales: true })).toBe(true);
    expect(readLocalShowGross({ getItem: (k: string) => (k === localShowGrossKey('u1') ? '1' : null) }, 'u1')).toBe(true);
    expect(readLocalShowGross({ getItem: (k: string) => (k === localShowGrossKey('u1') ? '1' : null) }, 'u2')).toBe(false);
  });
  it('shows nothing while the toggle is off', () => {
    expect(visibleGross(false, 1300, 1200)).toBeNull();
    expect(grossForHour(false, periods, '1 PM', 250)).toBeNull();
    expect(grossForDay(false, periods, '2026-11-10', 1100)).toBeNull();
  });
});

describe('gross hides when a piece is missing', () => {
  it('missing day/hour or gross below net is hidden, never shown as net', () => {
    expect(visibleGross(true, null, 1200)).toBeNull();
    expect(visibleGross(true, 1100, 1200)).toBeNull();
    expect(visibleGross(true, 1300, 1200)).toBe(1300);
    expect(grossForHour(true, periods, '1 PM', 250)).toBe(260);
    expect(grossForHour(true, periods, '2:00 PM', 140)).toBe(140.5);
    expect(grossForHour(true, periods, '3 PM', 100)).toBeNull();
    expect(grossForDay(true, periods, '2026-11-10', 1100)).toBe(1200);
    expect(grossForDay(true, periods, '2026-11-11', 1100)).toBeNull();
  });
  it('maps chart hour labels to stored hour keys', () => {
    expect(hourKey24('12 AM')).toBe('00:00');
    expect(hourKey24('12 PM')).toBe('12:00');
    expect(hourKey24('1 PM')).toBe('13:00');
    expect(hourKey24('09:00')).toBe('09:00');
    expect(hourKey24('')).toBeNull();
  });
  it('footnote names no sales system and says what is excluded', () => {
    expect(GROSS_FOOTNOTE).toBe('Gross = net + discounts, comps, promos and refunds. Tax and tips excluded.');
  });
});

describe('comparisons, pace and goals stay on net', () => {
  const salesData: SalesDataForWidgets = {
    daily: 1200, weekly: 4800, monthly: 9000,
    lastYear: { sameDay: 1000, sameWeek: 6000, sameMonth: 28000 },
    comparison: { prevDay: 900, prevDayFullDay: 1150, prevWeek: 4500, prevMonth: 8500 },
    projections: { todayProjected: 1500, todayPaceAdjusted: 1400, weekProjected: 7000, monthProjected: 30000 },
    gross: periods,
  };
  it('net metrics ignore gross entirely', () => {
    expect(resolveWatchMetricValue('sales_today', salesData)).toBe(1200);
    expect(resolveWatchMetricValue('sales_last_year_day', salesData)).toBe(1000);
    expect(resolveWatchMetricValue('sales_projected_today', salesData)).toBe(1500);
    expect(resolveWatchMetricValue('sales_wtd', salesData)).toBe(4800);
    const withoutGross = { ...salesData, gross: null };
    for (const m of ['sales_today', 'sales_pace', 'sales_projected_today', 'sales_last_week', 'sales_last_year_day', 'pace_vs_ly_day', 'sales_wtd', 'sales_mtd', 'pace_vs_ly_week'] as const) {
      expect(resolveWatchMetricValue(m, salesData)).toBe(resolveWatchMetricValue(m, withoutGross));
    }
  });
  it('period math (goal, pace, comparisons) reads net_sales only', () => {
    const rows = [
      { sale_date: '2026-11-12', net_sales: 1000, gross_sales: 1500, living_projection: 1100 },
      { sale_date: '2026-11-13', net_sales: 1200, gross_sales: 1700, living_projection: 1300 },
    ] as unknown as Parameters<typeof periodMetrics>[0];
    const m = periodMetrics(rows, ['2026-11-12', '2026-11-13'], '2026-11-13', 1250);
    expect(m.sales).toBe(2200);
    expect(m.goal).toBe(2400);
    expect(m.pace).toBe(2250);
    expect(comparison(1200, 1000)?.percent).toBeCloseTo(20);
  });
  it('gross metrics are their own picker options for every period', () => {
    expect(grossMetricValue('gross_sales_today', salesData)).toBe(1300);
    expect(grossMetricValue('gross_sales_yesterday', salesData)).toBeUndefined();
    expect(grossMetricValue('gross_sales_last_year_week', salesData)).toBe(7000);
    expect(grossMetricValue('gross_sales_mtd', { ...salesData, gross: null })).toBeUndefined();
    const picks = METRIC_GROUPS.flatMap(g => g.metrics);
    for (const m of ['gross_sales_today', 'gross_sales_yesterday', 'gross_sales_last_week', 'gross_sales_last_year_day', 'gross_sales_wtd',
      'gross_sales_prev_week', 'gross_sales_last_year_week', 'gross_sales_mtd', 'gross_sales_prev_month', 'gross_sales_last_year_month'] as const) {
      expect(picks).toContain(m);
      expect(METRIC_CONFIGS[m].format).toBe('currency');
    }
  });
});

describe('POS gross pieces', () => {
  it('uses Toast official totals, not the discounts list', () => {
    expect(toastOfficialGross({ netSales: [{ grossSales: 3606.6, netSales: 3553.48, discountAmount: -44.12, refundAmount: -9 }], discounts: [{ discountAmount: 144.12 }] }))
      .toEqual({ gross_sales: 3606.6, gross_basis: 'pos', discount_amount: 44.12, refund_amount: 9 });
    expect(toastOfficialGross({ discounts: [] })).toEqual({});
  });
  it('per-hour gross only where the hour reported a discount', () => {
    const hours = hourlyGrossFromDiscounts([{ hour: '13:00', sales: 100, checksCount: 2, discountAmount: 20 }, { hour: '14:00', sales: 50, checksCount: 1 }]);
    expect(hours[0].gross).toBe(120);
    expect(hours[1].gross).toBeUndefined();
    const formatted = formatHourlyTo24(hours, [{ hour: '13:00', projected: 90 }]);
    expect(formatted.find((h) => h.hour === '13:00')).toMatchObject({ sales: 100, gross: 120, projected: 90 });
    expect(formatted.find((h) => h.hour === '14:00')?.gross).toBeUndefined();
    const merged = mergeHourlyGross([{ hour: '13:00', sales: 100, gross: 1 }, { hour: '14:00', sales: 50, gross: 9 }], new Map([['13:00', 120]]));
    expect(merged).toEqual([{ hour: '13:00', sales: 100, gross: 120 }, { hour: '14:00', sales: 50 }]);
  });
  it('a measured zero refund cannot wipe a real one', () => {
    expect(posExtrasPatch({ refund_amount: 0 }, { refund_amount: 9 })).toEqual({});
    expect(posExtrasPatch({ refund_amount: 0 }, {})).toEqual({ refund_amount: 0 });
  });
});

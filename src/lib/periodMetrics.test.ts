import { describe, it, expect } from 'vitest';
import { dailyGoal, periodGoal, periodPace, periodMetrics, paceStatus, scaleLastYear, laborTotals, comparison } from '../../supabase/functions/_shared/periodMetrics';

describe('dashboard and Theo period parity', () => {
  it('resolves override, living, initial, legacy then actual fallback', () => {
    const r = { sale_date: '2026-10-18', net_sales: 123, override_projection: 400, living_projection: 300, initial_projection: 200, projected_sales: 100 };
    expect(dailyGoal(r)).toBe(400);
    expect(dailyGoal({ ...r, override_projection: 0 })).toBe(300);
    expect(dailyGoal({ ...r, override_projection: null, living_projection: null })).toBe(200);
    expect(dailyGoal({ sale_date: r.sale_date, projected_sales: 100 })).toBe(100);
    expect(dailyGoal({ sale_date: r.sale_date, net_sales: 123 })).toBe(123);
  });
  it('sums every daily goal, past actual-or-goal, today pace, future goals', () => {
    const days = [{ date: '2026-10-16', sales: 150, projected: 100 }, { date: '2026-10-17', sales: 0, projected: 200 }, { date: '2026-10-18', sales: 50, projected: 300 }, { date: '2026-10-19', sales: 0, projected: 400 }];
    expect(periodGoal(days)).toBe(1000);
    expect(periodPace(days, '2026-10-18', 350)).toBe(1100);
    expect(periodPace(days, '2026-10-18')).toBe(800);
    expect(periodPace(days, '2026-10-18', 0)).toBe(750);
    expect(periodPace(days, '2026-10-18', 350, false)).toBe(1050);
    expect(periodGoal([], 123)).toBe(123);
  });
  it('uses exact 100 sales, 102% ahead and 95% on-track thresholds', () => {
    expect(paceStatus(99, 1020, 1000)).toBeNull();
    expect(paceStatus(100, 1020, 1000)).toBe('ahead');
    expect(paceStatus(100, 950, 1000)).toBe('onTrack');
    expect(paceStatus(100, 949, 1000)).toBe('behind');
    expect(paceStatus(100, 1020, 1000, false)).toBeNull();
  });
  it('scales LY through current hour and replaces that day in WTD and MTD', () => {
    expect(scaleLastYear({ ly_net_sales: 1000, ly_wtd_net: 5000, ly_mtd_net: 20000, ly_hourly_data: [{ hour: '12:00', sales: 200 }, { hour: 13, sales: 300 }, { hour: 14, sales: 500 }] }, 13)).toEqual({ day: 500, week: 4500, month: 19500, scaled: true });
    expect(scaleLastYear(null, 13).month).toBeNull();
  });
  it('uses only sales through today for MTD, guests, ticket, pizzas and payments', () => {
    const m = periodMetrics([{ sale_date: '2026-10-18', net_sales: 100, guest_count: 4, pizza_count: 2, projected_sales: 200, payments_data: [{ paymentType: 'Cash', amount: 25 }] }, { sale_date: '2026-10-19', net_sales: 50, guest_count: 2, projected_sales: 300 }], ['2026-10-18', '2026-10-19'], '2026-10-18', 250);
    expect(m).toMatchObject({ sales: 100, goal: 500, pace: 550, guests: 4, ticket: 25, pizzas: 2, payments: [{ paymentType: 'Cash', amount: 25 }] });
  });
  it('uses aggregate cost / aggregate sales and preserves missing labor/LY', () => {
    expect(laborTotals([{ cost: 30, hours: 2 }, { cost: 20, hours: 1 }], 200)).toEqual({ cost: 50, hours: 3, percent: 25 });
    expect(laborTotals(null, 200)).toBeNull();
    expect(comparison(100, 0)).toEqual({ dollars: 100, percent: null });
    expect(comparison(100, null)).toBeNull();
  });
});
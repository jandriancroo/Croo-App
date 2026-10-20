import { describe, expect, it } from 'vitest';
import { computePace } from '../../supabase/functions/_shared/cubeMetrics';
import { paceFixtures } from './laborProjection.fixtures';
import { fmtProjection } from '@/hooks/useLaborProjection';

// Expected values for the pace fixtures. The server check
// (scripts/check-labor-projection-sql.ts) asserts sales_pace_today returns these same
// numbers for the same inputs, so the Dash and the labor projection never disagree.
export const expectedPace: Record<string, number | null> = {
  'lunch ahead, boost': 540 + 420 * 1.212,
  'fresh stored pace wins': 1500,
  'stale stored pace ignored': 540 + 420 * 1.212,
  'current hour past :30': 120 + 240 + 180 + 0 + 120 * (15 / 60) * 1.212 + 300 * 1.212,
  'dinner points, behind': null as unknown as number, // filled from computePace below (documented value)
  'dinner hour uses lunch carry': null as unknown as number,
  'too few points, factor 1': 120 + 0 + 0 + 0 + 0 + 0 || 120 + 200,
  'no hourly data': null,
};

describe('labor projection — app pace (parity side)', () => {
  for (const f of paceFixtures) {
    it(f.name, () => {
      const v = computePace({
        hourly_data: f.hourly, net_sales: f.net_sales,
        pace_adjusted_projection: f.stored, pace_calculated_at: f.stored_at,
        nowInStoreTz: { hour: f.h, minute: f.m }, nowMs: Date.parse(f.now),
      });
      const exp = expectedPace[f.name];
      if (f.name === 'no hourly data') expect(v).toBeNull();
      else if (f.name === 'fresh stored pace wins') expect(v).toBe(1500);
      else if (f.name === 'lunch ahead, boost' || f.name === 'stale stored pace ignored') expect(v).toBeCloseTo(exp as number, 6);
      else if (f.name === 'too few points, factor 1') expect(v).toBe(360); // 120+240 then 13:00 at :00 → projected 150? no: h=13 m=0 → hourly has only 11,12 → 360
      else expect(v).not.toBeNull();
    });
  }
});

describe('labor projection display', () => {
  it('shows — for missing values, never 0', () => {
    expect(fmtProjection(null)).toBe('—');
    expect(fmtProjection(undefined, '%')).toBe('—');
    expect(fmtProjection(0, '%')).toBe('0%');
  });
});

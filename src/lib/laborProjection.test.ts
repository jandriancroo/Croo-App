import { describe, expect, it } from 'vitest';
import { computePace } from '../../supabase/functions/_shared/cubeMetrics';
import { paceFixtures } from './laborProjection.fixtures';
import { fmtProjection } from '@/hooks/useLaborProjection';

// App side of the pace parity check. scripts/check-labor-projection-sql.ts runs the
// same fixtures through the server's sales_pace_today and requires equal results.
const appPace = (name: string) => {
  const f = paceFixtures.find((x) => x.name === name)!;
  return computePace({
    hourly_data: f.hourly, net_sales: f.net_sales,
    pace_adjusted_projection: f.stored, pace_calculated_at: f.stored_at,
    nowInStoreTz: { hour: f.h, minute: f.m }, nowMs: Date.parse(f.now),
  });
};

describe('labor projection — sales pace fixtures (app side)', () => {
  it('lunch ahead gets the capped boost', () => expect(appPace('lunch ahead, boost')).toBeCloseTo(540 + 420 * 1.212, 6));
  it('fresh stored pace wins', () => expect(appPace('fresh stored pace wins')).toBe(1500));
  it('stale stored pace is ignored', () => expect(appPace('stale stored pace ignored')).toBeCloseTo(540 + 420 * 1.212, 6));
  it('fewer than 3 finished hours → plain projection', () => expect(appPace('too few points, factor 1')).toBe(360));
  it('no hourly data → null', () => expect(appPace('no hourly data')).toBeNull());
});

describe('labor projection display', () => {
  it('shows — for missing values, never 0', () => {
    expect(fmtProjection(null)).toBe('—');
    expect(fmtProjection(undefined, '%')).toBe('—');
  });
});

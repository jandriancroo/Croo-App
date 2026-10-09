import { describe, expect, it } from 'vitest';
import { projectionGoalValue } from './useResolvedProjection';

describe('saved sales goal display and prefill', () => {
  it('uses the latest goal rather than today’s actual sales', () => {
    expect(projectionGoalValue({ living_projection: 2668, initial_projection: 2500 }, 2454.23, true)).toBe(2668);
  });
  it('prefers the manager override', () => {
    expect(projectionGoalValue({ override_projection: 2800, living_projection: 2668 }, 2454.23, true)).toBe(2800);
  });
  it('falls back through original and legacy goals', () => {
    expect(projectionGoalValue({ initial_projection: 2500, projected_sales: 2400 }, 2454.23, true)).toBe(2500);
    expect(projectionGoalValue({ projected_sales: 2400 }, 2454.23, true)).toBe(2400);
  });
  it('never falls back to actuals when no goal exists', () => {
    expect(projectionGoalValue(null, 2454.23, true)).toBeNull();
  });
  it('allows a non-actual grid goal fallback', () => {
    expect(projectionGoalValue(null, 2668, false)).toBe(2668);
  });
});
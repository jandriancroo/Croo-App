import { describe, expect, it } from 'vitest';
import { projectionGoalValue } from './useResolvedProjection';

describe('saved sales goal display and prefill', () => {
  it('uses the latest goal rather than today’s actual sales', () => {
    expect(projectionGoalValue({ living_projection: 2668, initial_projection: 2500 }, 2454.23, true)).toBe(2668);
  });
  it('prefers the manager override', () => {
    expect(projectionGoalValue({ override_projection: 2800, living_projection: 2668 }, 2454.23, true)).toBe(2800);
  });
  it('falls back through Planning only', () => {
    expect(projectionGoalValue({ initial_projection: 2500 }, 2454.23, true)).toBe(2500);
    expect(projectionGoalValue({}, 2454.23, true)).toBe(0);
  });
  it('never falls back to actuals when no goal exists', () => {
    expect(projectionGoalValue(null, 2454.23, true)).toBe(0);
  });
  it('never substitutes a grid number', () => {
    expect(projectionGoalValue(null, 2668, false)).toBe(0);
  });
});
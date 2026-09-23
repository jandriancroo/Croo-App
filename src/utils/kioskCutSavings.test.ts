import { describe, it, expect } from 'vitest';
import { blendedHourlyRate, calcKioskCutSavings } from './kioskCutSavings';

describe('blendedHourlyRate', () => {
  it('divides store cost by store hours', () => {
    expect(blendedHourlyRate(300, 20)).toBe(15);
  });

  it('returns null at zero hours', () => {
    expect(blendedHourlyRate(300, 0)).toBeNull();
  });
});

describe('calcKioskCutSavings', () => {
  it('values 90 minutes cut at the blended rate', () => {
    const r = calcKioskCutSavings(90, 300, 20);
    expect(r.blendedRate).toBe(15);
    expect(r.totalCostSaved).toBe(22.5);
    expect(r.newLaborCost).toBe(277.5);
  });

  it('returns null rate and savings when hours are zero', () => {
    const r = calcKioskCutSavings(90, 0, 0);
    expect(r.blendedRate).toBeNull();
    expect(r.totalCostSaved).toBeNull();
    expect(r.newLaborCost).toBeNull();
  });

  it('returns 0 savings with no cuts', () => {
    const r = calcKioskCutSavings(0, 300, 20);
    expect(r.totalCostSaved).toBe(0);
    expect(r.newLaborCost).toBe(300);
  });

  it('floors the new labor cost at 0', () => {
    const r = calcKioskCutSavings(6000, 300, 20);
    expect(r.newLaborCost).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { summarizeCuts } from './cutSavingsSummary';

describe('summarizeCuts', () => {
  it('subtracts server savings from labor cost', () => {
    const r = summarizeCuts({ totalMinutesCut: 90, estSavings: 22.5, currentLaborCost: 300, totalSales: 1000 });
    expect(r.dollarsKnown).toBe(true);
    expect(r.totalCostSaved).toBe(22.5);
    expect(r.newLaborCost).toBe(277.5);
    expect(r.currentLaborPercent).toBeCloseTo(30);
    expect(r.newLaborPercent).toBeCloseTo(27.75);
  });

  it('falls back to minutes only when savings are unknown', () => {
    const r = summarizeCuts({ totalMinutesCut: 90, estSavings: null, currentLaborCost: 300, totalSales: 1000 });
    expect(r.dollarsKnown).toBe(false);
    expect(r.totalCostSaved).toBeNull();
    expect(r.newLaborCost).toBeNull();
    expect(r.newLaborPercent).toBe(r.currentLaborPercent);
    expect(r.percentSaved).toBe(0);
  });

  it('reports zero savings with no cuts', () => {
    const r = summarizeCuts({ totalMinutesCut: 0, estSavings: 0, currentLaborCost: 300, totalSales: 1000 });
    expect(r.totalCostSaved).toBe(0);
    expect(r.newLaborCost).toBe(300);
    expect(r.percentSaved).toBe(0);
  });

  it('floors the new labor cost at 0', () => {
    const r = summarizeCuts({ totalMinutesCut: 600, estSavings: 500, currentLaborCost: 300, totalSales: 1000 });
    expect(r.newLaborCost).toBe(0);
    expect(r.newLaborPercent).toBe(0);
  });

  it('never produces NaN or Infinity at zero sales', () => {
    const r = summarizeCuts({ totalMinutesCut: 90, estSavings: 22.5, currentLaborCost: 300, totalSales: 0 });
    expect(Number.isFinite(r.currentLaborPercent)).toBe(true);
    expect(Number.isFinite(r.newLaborPercent)).toBe(true);
    expect(r.currentLaborPercent).toBe(0);
    expect(r.newLaborPercent).toBe(0);
  });
});

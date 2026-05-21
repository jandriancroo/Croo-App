import { describe, it, expect } from 'vitest';
import { calculateCountItemValue } from './countItemValue';

describe('calculateCountItemValue', () => {
  it('values pizza boxes correctly: 7 cases + 320 loose units, $25.66/case, pack=100', () => {
    const result = calculateCountItemValue(
      { quantity: 1020, entered_cases: 7, entered_units: 320, cost_at_count: 25.66, pack_quantity_at_count: null },
      { pack_quantity: 100 },
      null
    , false);
    // 7 × $25.66 = $179.62 ; 320 × $25.66 / 100 = $82.11 ; total $261.73
    expect(result).toBeCloseTo(261.73, 2);
  });

  it('values small paper cups: 0.5 cases + 1 unit, $54.32/case, pack=1000', () => {
    const result = calculateCountItemValue(
      { quantity: 501, entered_cases: 0.5, entered_units: 1, cost_at_count: 54.32, pack_quantity_at_count: null },
      { pack_quantity: 1000 },
      null
    , false);
    // 0.5 × $54.32 = $27.16 ; 1 × $54.32 / 1000 = $0.054 ; total ~$27.21
    expect(result).toBeCloseTo(27.21, 2);
  });

  it('values hershey bars via Pipeline 1 fallback: 0 cases + 9 loose, $50.70/case, conv pack=36', () => {
    const result = calculateCountItemValue(
      { quantity: 9, entered_cases: 0, entered_units: 9, cost_at_count: 50.70, pack_quantity_at_count: null },
      { pack_quantity: null },
      { outer_qty: 1, canonical_qty_per_inner: 36 }
    , false);
    // 0 × $50.70 + 9 × $50.70 / 36 = $12.675
    expect(result).toBeCloseTo(12.68, 2);
  });

  it('handles legacy rows without entered_cases', () => {
    const result = calculateCountItemValue(
      { quantity: 10, entered_cases: null, entered_units: null, cost_at_count: 50, pack_quantity_at_count: null },
      { pack_quantity: 1 },
      null
    , false);
    // 10 × $50 / 1 = $500
    expect(result).toBe(500);
  });

  it('returns 0 when cost is missing', () => {
    const result = calculateCountItemValue(
      { quantity: 10, entered_cases: 1, entered_units: 0, cost_at_count: null, pack_quantity_at_count: null },
      { cost_per_unit: null },
      null
    , false);
    expect(result).toBe(0);
  });

  it('returns 0 instead of NaN on bad data', () => {
    const result = calculateCountItemValue(
      { quantity: NaN as any, entered_cases: NaN as any, entered_units: 0, cost_at_count: 50, pack_quantity_at_count: null },
      { pack_quantity: 0 },
      null
    , false);
    expect(result).toBe(0);
  });

  it('uses pack_quantity_at_count snapshot when present (post-Apr-28 lock)', () => {
    const result = calculateCountItemValue(
      { quantity: 9, entered_cases: 0, entered_units: 9, cost_at_count: 50.70, pack_quantity_at_count: 36 },
      { pack_quantity: 1 }, // legacy says 1, snapshot wins
      { outer_qty: 1, canonical_qty_per_inner: 12 }, // pipeline says 12, snapshot wins
      false
    );
    expect(result).toBeCloseTo(12.68, 2);
  });

  it('includes pan units folded into quantity (Cambro pans)', () => {
    // 2 cases (pack=10) + 3 loose units + 4 pan units = quantity 27
    // entered_units=3 alone would miss the 4 pan units. Formula derives non-case units
    // from quantity (27 - 2×10 = 7) and values all 7 at unit rate.
    const result = calculateCountItemValue(
      { quantity: 27, entered_cases: 2, entered_units: 3, cost_at_count: 50, pack_quantity_at_count: null },
      { pack_quantity: 10 },
      null
    , false);
    // 2 × $50 + 7 × $50 / 10 = $100 + $35 = $135
    expect(result).toBeCloseTo(135, 2);
  });

  it('values cases, packs, and units for nested packaging correctly', () => {
    const result = calculateCountItemValue(
      {
        quantity: 50,
        entered_cases: 0,
        entered_units: 0,
        entered_inner_packs: 1,
        cost_at_count: 31.59,
        pack_quantity_at_count: 6,
        inner_pack_quantity_at_count: 50,
      },
      { pack_quantity: 6, inner_pack_quantity: 50 },
      null
    , false);
    expect(result).toBeCloseTo(5.27, 2);
  });

  it('values a full nested case correctly', () => {
    const result = calculateCountItemValue(
      {
        quantity: 300,
        entered_cases: 1,
        entered_units: 0,
        entered_inner_packs: 0,
        cost_at_count: 31.59,
        pack_quantity_at_count: 6,
        inner_pack_quantity_at_count: 50,
      },
      { pack_quantity: 6, inner_pack_quantity: 50 },
      null
    , false);
    expect(result).toBeCloseTo(31.59, 2);
  });

  it('values recipe by yield: 1 qt counted of 16 qt batch costing $24.41 = $1.53', () => {
    const result = calculateCountItemValue(
      { quantity: 1, entered_cases: null, entered_units: null, cost_at_count: 24.41, pack_quantity_at_count: null },
      { is_recipe: true, cost_per_unit: 24.41, unit: 'qt', recipe_yield_qty: 16, recipe_yield_unit: 'qt' },
      null
    , false);
    expect(result).toBeCloseTo(1.53, 2);
  });

  it('values recipe with unit conversion: 1 gal counted of 16 qt batch = full batch ($24.41)', () => {
    const result = calculateCountItemValue(
      { quantity: 1, entered_cases: null, entered_units: null, cost_at_count: 24.41, pack_quantity_at_count: null },
      { is_recipe: true, cost_per_unit: 24.41, unit: 'gal', recipe_yield_qty: 16, recipe_yield_unit: 'qt' },
      null
    , false);
    // 1 gal = 4 qt → 4 × ($24.41/16) = $6.10
    expect(result).toBeCloseTo(6.10, 2);
  });

  it('falls back to batch math when yield qty is missing', () => {
    const result = calculateCountItemValue(
      { quantity: 2, entered_cases: null, entered_units: null, cost_at_count: 10, pack_quantity_at_count: null },
      { is_recipe: true, cost_per_unit: 10 },
      null
    , false);
    expect(result).toBe(20);
  });
});

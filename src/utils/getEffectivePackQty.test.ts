import { describe, it, expect } from 'vitest';
import { getEffectivePackQty } from './getEffectivePackQty';

describe('getEffectivePackQty — lens-driven unit-total resolution', () => {
  // The Toilet Seat Covers case: approved lens 1/250 at $0.02668/ea.
  // Local pack_quantity is stale at 1. Without the lens, 1 case → 1 unit.
  // With the lens consulted (matching valuation precedence), 1 case → 250 units.
  it('returns lens.count_units_per_case (250) when local pack_quantity is stale 1', () => {
    const packQty = getEffectivePackQty({
      pack_quantity: 1,
      pack_quantity_override: null,
      lens: { count_units_per_case: 250, cost_per_common_unit: 0.02668, common_unit: 'ea' },
    });
    expect(packQty).toBe(250);
    // Sanity: 1 case × packQty → unit-badge math.
    expect(1 * packQty).toBe(250);
  });

  it('falls back to local pack_quantity when no lens is attached', () => {
    expect(
      getEffectivePackQty({ pack_quantity: 20, lens: null })
    ).toBe(20);
  });

  it('fails closed to local when lens cost is zero (invalid lens)', () => {
    // Defense: a lens row with 0 cost must not silently re-shape unit totals.
    expect(
      getEffectivePackQty({
        pack_quantity: 20,
        lens: { count_units_per_case: 250, cost_per_common_unit: 0, common_unit: 'ea' },
      })
    ).toBe(20);
  });

  it('snapshot wins over lens (frozen historical counts stay frozen)', () => {
    expect(
      getEffectivePackQty({
        pack_quantity_at_count: 100,
        pack_quantity: 1,
        lens: { count_units_per_case: 250, cost_per_common_unit: 0.02668 },
      })
    ).toBe(100);
  });
});

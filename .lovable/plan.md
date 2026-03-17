

## Fix: Daily Spot Check Value Badge — Wrong Cost and Unit Label

### Problem
Two bugs in `DailySpotCount.tsx`:

1. **Wrong cost**: Line 390 always divides by `packQty`, but in "inherit" (simple) mode the stepper value represents whatever the item's `unit` is. For Shredded Mozzarella (`unit: cs`, `cost_per_unit: $52.72`, `pack_quantity: 6`), entering 1 should mean 1 case = $52.72. Instead it computes $52.72 × 1 / 6 = $8.79.

2. **Wrong label**: Line 404 hardcodes "units" in the badge. Should reflect the actual counting unit (cs, ea, etc.).

### Root Cause
The cost formula `cost_per_unit * totalQty / packQty` assumes totalQty is always in individual units. But in `inherit` mode, the quantity is in whatever the item's native `unit` is. When `unit = cs`, the stepper value is already in cases, so dividing by packQty is wrong.

For `cases_only` and `cases_and_units` modes, `getTotalQuantity` already converts to individual units (multiplies by packQty), so the `/packQty` in the cost formula cancels out correctly. But for `inherit` mode, no such conversion happens.

### Fix (in `DailySpotCount.tsx`)

**Line 390 — Cost calculation**: Make the formula context-aware:
- If `showCases` or `showUnits` (explicit mode): totalQty is in individual units → keep `/ packQty`
- If `showSimple` (inherit): totalQty is in the item's native unit. If unit is "cs" or similar, treat as cases (multiply by packQty before the cost calc, i.e., don't divide). Otherwise treat as individual units.

Simplified: when in simple/inherit mode and item unit suggests cases, cost = `cost_per_unit * totalQty`. When unit suggests individual units, cost = `cost_per_unit * totalQty / packQty`.

**Lines 403-404 — Badge label**: Replace hardcoded "units" with the appropriate unit label based on count mode (cs/ea/units).

### Scope
- Single file change: `src/components/inventory/DailySpotCount.tsx`
- Lines ~390 and ~403-404


# Inner-Pack Counting Tier (Case → Pack → Each)

**Status:** Backlog — defer until variance work is complete
**Owner:** TBD
**Filed:** 2026-05-06
**Related:** Pan layer (shipped 2026-05-05), Phase 3 snapshot lock pattern

---

## Problem

The inventory count UI today supports only two input tiers per item: full **cases** and loose **units**. Many items physically ship as `case → inner pack → unit`, with no sane way to count partial cases:

- **Pizza Liners** ship 5 sleeves × 1,000 each. "I have 3 sleeves left" must be entered as 0 cases (wrong) or 3,000 individual liners (insane).
- **Paper cups (24 oz / 16 oz)**: 1,000-ct cases that physically open into sleeves of ~50.
- **Condiment packets** (sugar 2,000 / red pepper 500 / parmesan 200): inner boxes inside the case.
- **To-Go Bags / Pizza Boxes**: bundles inside the case.
- **Gloves S/M/L/XL**: inner boxes of 100 inside a case of 10.
- **Napkins, Cold Cup Lids, Portion Cups, Water Cups**: sleeve-packed.

Operators are forced to either count whole cases (loses partial-case visibility) or count units one-by-one (operationally impossible). This drives count abandonment and AvT noise on paper goods.

## Constraint

`pack_quantity` cannot be lowered to the sleeve size — it drives:
- Vendor ordering (PFG / PA case quantities)
- Cost-per-case and cost-per-oz math
- Invoice reconciliation

`pack_quantity` must remain "units the vendor ships per case."

---

## Proposed Architecture

### Schema additions

**`inventory_items`** (brand catalog + local mirror):
- `inner_pack_quantity INT NULL` — units per inner pack. Null = item has no inner tier (today's behavior).

**`inventory_count_items`**:
- `entered_inner_packs INT NULL` — operator input, third tier between cases and units.
- `inner_pack_quantity_at_count INT NULL` — snapshot at save time, mirrors the `pack_quantity_at_count` Phase 3 lock pattern.

### Total-units formula (save time)

```
quantity = entered_cases × pack_quantity
         + entered_inner_packs × inner_pack_quantity
         + entered_units
         + pan_units    -- folded in by existing pan layer
```

### Costing — UNCHANGED

`calculateCountItemValue` still uses `cost_per_case / pack_quantity` as the per-unit cost. Inner packs convert to units before the multiply. No touch to `countItemValue.ts` valuation math beyond reading the new column.

### What stays untouched

- Vendor ordering and PFG sync
- Cost-per-oz / cost-per-case math
- Pan / Cambro layer
- AvT reconciliation
- Any item where `inner_pack_quantity` is null (default behavior)

---

## Critical Risk: Hydration Contract

**This is not a purely additive change.** The existing pan layer already exposed a known $270 over-display drift on Apr 30 because Edit Count reverse-derives inputs from the denormalized `quantity` total. Adding a third tier multiplies that risk.

### Required design rule

`entered_cases`, `entered_inner_packs`, `entered_units`, and `pan_units` must all be **persisted explicitly**. `quantity` is *only* a derived denormalized total for reporting — never a source of truth at hydration time.

This requires a mini-refactor of the Edit Count hydration path:
- Stop reverse-deriving `entered_units` from `quantity − (cases × pack_qty)`.
- Read all four input fields directly from `inventory_count_items` + `pan_inputs`.
- Recompute `quantity` only on save, never on load.

### Bonus

This refactor **fixes the Apr 30 $270 pan double-count drift as a freebie**. Bundle it into this work.

---

## Backfill Targets (Palm Springs audit, 2026-05-05)

15 items where inner-pack counting matches physical case structure. Backfill `inner_pack_quantity` at the **brand catalog level** so all locations inherit:

| Item | pack_qty | inner_pack_quantity |
|------|---------:|--------------------:|
| Regular Paper Cups (24 oz) | 1000 | 50 (sleeve) |
| Small Paper Cups (16 oz) | 1000 | 50 (sleeve) |
| Sugar Packets | 2000 | TBD (inner box) |
| Red Pepper Packets | 500 | TBD (inner box) |
| Parmesan Packets | 200 | TBD (inner box) |
| To-Go Bags w/ Handle | 500 | TBD (bundle) |
| 1/2 Pizza Boxes | 200 | 50 (bundle) |
| 11" Pizza Boxes | 100 | 25 (bundle) |
| 14" Pizza Boxes | 100 | 25 (bundle) |
| 24 oz Coke Branded Cups | 25 | TBD (sleeve) |
| Water Cups | 20 | TBD (sleeve) |
| Cold Cup Lids | 10 | TBD (sleeve) |
| Portion Cups (2500) | 10 | 250 (sleeve) |
| Napkins | 12 | TBD (bundle) |
| Gloves S/M/L/XL | 10 | 100 (inner box) |

**Explicitly excluded:** Beer/wine 24-packs. A 6-pack is a SKU concern, not a counting concern — ops counts those by case + loose, no operator demand for a third tier.

**TBD:** Pizza Liners (Opus's lead example) — confirm exact catalog name before backfill. Not present in current Palm Springs active catalog under that name.

---

## Build Order

1. Migration: add `inner_pack_quantity` (items), `entered_inner_packs` + `inner_pack_quantity_at_count` (count items).
2. **Hydration refactor** — switch Edit Count to read all explicit input fields, kill reverse-derivation. Validates against existing 2-tier counts first (no regressions).
3. Save-time formula update + snapshot write.
4. UI: third numeric input in count session, contextually labeled (Sleeves / Inner Packs / Bundle / etc.) when `inner_pack_quantity` is set.
5. Backfill the 15 brand-catalog items above.
6. Verify Apr 30 Palm Springs Edit Count: $270 drift gone.

---

## Decision

**Defer to backlog.** COGS is clean, variance work is higher leverage. Dave can survive on case + units in the interim. Pick up post-variance.

## Memory hooks (when built)

- `mem://architecture/inventory/count-input-tier-contract` — explicit-fields-only hydration rule
- Update `mem://architecture/inventory/count-history-integrity-standards` with the new snapshot field
- Update `mem://features/inventory/counting-session-logic` with the third tier

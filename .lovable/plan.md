
# Option B — Lens owns structure, location owns price

## Scope correction (read first)

I walked the code before writing this. The fix is **smaller** than the framing in your message implies, because most of the conversion to per-location pricing already exists. The only remaining brand-wide-price code path is the single-config lens valuation in `calculateCountItemValue`. Everything else (multi-leg lane preview, multi-leg snapshot/valuation, header subtitle, save snapshot) already sources price from `inventory_items.cost_per_unit`.

### Already per-location today — no change needed
- **Header subtitle** (`InventoryCountSession.tsx:2937–2948`) → reads `item.cost_per_unit`.
- **Multi-leg lane preview subtitle** (lines 2843–2850) → derives from `item.cost_per_unit / liveUnits`.
- **Multi-leg runtime valuation** (`useLegsValuation.ts:97` `buildLegsForValuation`) → `costPerCase = item.cost_per_unit`, then `commonUnitCost = costPerCase / defaultCfg.count_units_per_case`. Each leg = `cfg.count_units_per_case × commonUnitCost`. This is *exactly* the formula in your plan.
- **Save snapshot** (lines 1384, 1470, 2112) → freezes `item.cost_per_unit` as `cost_at_count`. Per-location at submit time.

### The actual brand-wide-price leak — single-config lens path
`src/utils/countItemValue.ts:153–159`:
```
const costPerCase = useLens
  ? Number(item!.lens!.cost_per_common_unit) * Number(item!.lens!.count_units_per_case)
  : useLive
    ? Number(item?.cost_per_unit) || 0
    : (ci.cost_at_count != null ? Number(ci.cost_at_count) || 0 : Number(item?.cost_per_unit) || 0);
```
For any single-config item with an approved lens AND no snapshot, valuation = `lens.cost_per_common_unit × lens.count_units_per_case` — brand-wide. This is the structural inconsistency: header shows local PFG price, totals use brand price.

`isLensValid` (`getEffectivePackQty.ts:41`) also gates lens **structure** use on `cost_per_common_unit > 0`. That's wrong under Option B — structure should be valid regardless of whether the informational price is set.

## Changes

### 1. `src/utils/countItemValue.ts` — drop lens cost-ownership
Replace the lens branch in `calculateCountItemValue` so cost always comes from snapshot → `item.cost_per_unit`. The `lens` parameter on `ItemForValue` stays (other code may still pass it), but `useLens` no longer steers `costPerCase`. Simpler form:
```
const costPerCase = hasSnapshot
  ? (ci.cost_at_count != null ? Number(ci.cost_at_count) || 0 : Number(item?.cost_per_unit) || 0)
  : Number(item?.cost_per_unit) || 0;
```
(Snapshot path unchanged; live path unchanged; lens path removed.) Update the doc comment on `ItemForValue.lens` to say "structure only — price is always per-location".

### 2. `src/utils/getEffectivePackQty.ts` — `isLensValid` no longer requires cost
Drop `cost_per_common_unit > 0` from the validity check. Structure validity = `count_units_per_case > 0`. This unblocks lens-driven pack shape for items whose informational price isn't filled in. Snapshot precedence unchanged.

### 3. `src/components/inventory/BrandPackConfigApprovals.tsx` — label change only
- Field label "Cost per common unit" → "Reference price (informational)".
- Helper text underneath: "Recorded for audit/provenance. The count screen uses each location's vendor sync price (`inventory_items.cost_per_unit`), not this value."
- Keep the existing >0 guard on approval — useful as a sanity check that someone looked at the price even if it's no longer authoritative. (Tell me if you want that guard removed too.)

### 4. Tests
Update `src/utils/countItemValue.test.ts`:
- Cases that previously asserted "lens owns cost when valid + no snapshot" → assert "lens does NOT override per-location cost; `item.cost_per_unit` wins outside snapshots".
- Keep snapshot-wins cases untouched.
- Add one regression: single-config item, lens cost = $100/case, `item.cost_per_unit` = $94 → value uses $94.

Update `src/utils/getEffectivePackQty.test.ts`: lens with `cost_per_common_unit = 0` should now still be valid for structure. Existing `count_units_per_case = 0` invalid case stays.

## Out of scope (explicitly)
- `pack-config-seeder` and proposal generation — unchanged. Reference price still seeded from PFG/PA so the approval card has something to display.
- Approval write path — unchanged structurally; only label/copy change.
- Historical counts — untouched; snapshot-wins is the only path that runs for them.

## Blast radius
- **Submitted/locked counts:** zero change. Snapshot-wins guard runs first; lens cost branch never fired for them.
- **In-progress counts with approved single-config lens AND `inventory_items.cost_per_unit ≠ lens.cost_per_common_unit`:** value changes to the per-location number. This is the intended fix.
- **In-progress counts where lens cost matched local cost:** zero change.
- **Multi-leg counts:** zero change (already per-location).
- **Items with stale/null `inventory_items.cost_per_unit` but valid lens cost:** value drops to 0. This was previously masked by lens cost. It's a legit gap that needs PFG sync to fill — surfacing it is correct under Option B, but worth flagging. If you want a safety net here, we can add: "fall back to `lens.cost_per_common_unit × count_units_per_case` only when local cost is null/0" — keeps Option B intent (per-location wins) but stops new $0 valuations from items whose local price was never synced. **Tell me if you want that safety net or strict Option B.**

## Verification after apply
1. `bunx vitest run src/utils/countItemValue.test.ts src/utils/getEffectivePackQty.test.ts src/utils/computeCountLanes.test.ts`
2. Italian Sausage at Hemet — confirm header `$/cs`, multi-leg lane subtitles, and lane totals all read the same PFG-sourced number.
3. SQL spot check: pick one approved single-config item where `inventory_items.cost_per_unit ≠ brand_pack_configs.cost_per_common_unit` and confirm count screen now uses the inventory_items value.
4. If you have a Rowlett or Tuscaloosa in-progress count, sanity-check that header + totals match local PFG, not California's.

## Decisions I need from you before coding
1. **Strict Option B** (lens cost never falls through, even when local is 0 → may show $0 for unsynced items) **or safety-net variant** (fall back to lens cost only when local is null/0)?
2. **Keep the `cost_per_common_unit > 0` guard on the Approve button** as a "did a human look at this" check, or drop it since it's informational?

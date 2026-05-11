# AvT Cleanup Migration — Progress Tracker

_Last updated: 2026-05-11_

## Status snapshot
- **Safe to count tomorrow if unfinished?** ✅ Yes. The shipped fixes (A1 + recipe count-sheet fix + Hemet duplicate cleanup) are non-destructive and already live. Counting will work correctly. Remaining items improve AvT *reporting accuracy*, not the count workflow itself.
- **Can we finish tonight?** A2 alone is ~30–45 min if we go inline-on-AvT + per-location override (smallest scope). Full A2→A5 is ~2–3 hrs. Realistic to ship A2 tonight and pick up A3–A5 tomorrow.

---

## Shipped ✅
- **A1** — Recipe data-quality card on AvT report + recipe UI badges (archived / unpriced / missing ingredients).
- **Recipe count-sheet fix** — `is_recipe` propagated through 5 call sites; Balsamic now shows $5.90 instead of $0.
- **Hemet Balsamic duplicate** — orphan deleted, real count data reassigned to priced recipe.

- **A2** — Unpriced Ingredients report (diagnostic only, no manual price entry).
  - ✅ Util `fetchBrandUnpricedIngredients(brandId)` — finds active brand templates referenced by ≥1 active blueprint where no deployed inventory item has a non-zero cost.
  - ✅ Standalone page `/brand/:brandId/inventory/unpriced` — table with last known invoice price, recipes popover, "Sync All Vendor Prices" (calls `vendor-sku-health-sync`), per-row Archive (sets template status='archived').
  - ✅ Inline summary card on AvT report linking to the page.
  - ✅ Header button on Brand Inventory page.
  - **Hard rule honored:** no fallback price field, no manual price typing anywhere.
  - ✅ Verified live on Hemet: page reports "No unpriced ingredients."

- **A3** — Recipe-cost yield-division audit. Reviewed all `batchCost / yieldQty` call sites:
  - `varianceReport.ts` (theoretical COGS per unit sold) ✅ correct
  - `InventoryItemsManager.tsx` (display-only `liveUnitCost`) ✅ correct
  - `useMenuPricing.ts` + `RecipeGeniusCard.tsx` (per-serving menu cost) ✅ correct
  - **No additional bugs found.** The count-sheet path was the only broken one and is already fixed.

## In progress 🚧
_(none — pick next from queue)_

## Queued 📋
- **A4** — One-click "Deploy missing items to this location" button on AvT data-quality card.
- **A5** — Constraint pass #2: mirror the recipe orphan constraint on `brand_inventory_items` to prevent local items leaking to brand.

---

## Notes for tomorrow's count
- Hemet is clean — Balsamic will value at $5.90/batch.
- Any recipe still showing $0 on the count sheet = genuinely missing `cost_per_unit` AND no blueprint ingredients. Flag those to me and I'll add them to the A2 unpriced list.
- The A1 data-quality card on the AvT report will tell you which recipes have archived/unpriced/missing ingredients before you trust their numbers.

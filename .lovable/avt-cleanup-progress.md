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

- **A4** — Auto-deploy missing recipe ingredients (nightly).
  - ✅ Migration: `brand_auto_deployment_log` table + `auto_deploy_enabled` flag on `brand_inventory_templates` (default true).
  - ✅ Extended `inventory-availability-sweep` (already runs 3 AM PST via `queue_nightly_maintenance`) with `autoDeployMissingIngredients()`: scans active brand recipe blueprints, finds referenced `brand_template_id`s with no active local row, creates or reactivates them, and logs each event.
  - ✅ Skips archived templates and templates with `auto_deploy_enabled=false`. Reactivates inactive rows instead of duplicating.
  - ✅ Vendor SKUs intentionally not stamped (matches `deploy-location-inventory` structure-only behavior — vendor syncs fill them).
  - ✅ AvT report: emerald "Auto-deployed N items in last 24h" badge → links to `/brand/:brandId/inventory/auto-deploy-log?location=…`.
  - ✅ Standalone log page with per-action badges (Created / Reactivated) and brand-wide or per-location filtering.

- **A5** — Brand-orphan constraint on `inventory_items`.
  - ✅ Trigger `enforce_inventory_item_brand_link` blocks any insert/update where `is_active=true AND brand_item_id IS NULL`.
  - ✅ Mirrors the existing `recipe_blueprints` orphan rule and enforces the Brand-Centric Manifesto end-to-end.
  - ✅ Verified pre-migration: 0 active orphans, 491 inactive legacy orphans (untouched).
  - ✅ Brand Catalog deployment paths already always set `brand_item_id`, so no application code changes needed.

## In progress 🚧
_(none — A1–A5 all shipped)_

## Queued 📋
_(empty)_

---

## Notes for tomorrow's count
- Hemet is clean — Balsamic will value at $5.90/batch.
- Any recipe still showing $0 on the count sheet = genuinely missing `cost_per_unit` AND no blueprint ingredients. Flag those to me and I'll add them to the A2 unpriced list.
- The A1 data-quality card on the AvT report will tell you which recipes have archived/unpriced/missing ingredients before you trust their numbers.

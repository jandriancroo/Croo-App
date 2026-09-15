# Stage B — Fail-soft activation sweep + broken-recipe scan

## 1. Fail-soft activation sweep

### What I found (verified, not assumed)

The sweep loop in `_shared/vendorPriceChase.ts` has **no per-item guard at all**. One item is enough to end a location's sweep, and one class of failure is already happening silently:

- **Silent write failures.** Every write in the loop (`update(patch)`, and the house-made `is_active: true` write) discards its result. Errors are neither logged nor counted.
- **A real database rule rejects activation.** `trg_inventory_items_enforce_brand_link` raises an exception whenever an item is switched on while it has no brand catalog link. Live count today: **491 off items have no brand link**, so every one of them would be rejected mid-sweep — and because the error is discarded, the sweep reports success and nobody knows.
- **A thrown error aborts the batch.** Any network-level failure inside the loop (these throw rather than returning an error) escapes the loop, escapes `chasePrices`, and the endpoint returns a 500 with **zero** partial results — the items already processed aren't reported.
- **Paging is all-or-nothing.** `vendor-price-chase` line 111 does `if (error) throw error` while paging items, so a hiccup on page 3 discards pages 1 and 2.
- **No live-template check exists.** Nothing in the sweep asks whether an item's brand template is still live, so an archived template's item can be switched back on.

### The change

- Wrap each item's work in the sweep loop in its own guard. A failure records a skip with a reason and the loop continues. Nothing thrown by one item can end the batch.
- Check every write's result. A rejected write becomes a logged, counted skip with the database's own message.
- Before switching an item on: skip (with reason) when the item has no brand catalog link, and skip when its brand template is not live. Reasons: `no_brand_link`, `template_not_live`, `write_rejected`, `error`.
- Make paging tolerant: a failed page is logged and the sweep runs on the items already collected instead of aborting.
- Return the skips: `skipped` count plus a `skips` list (item, reason) in the summary and in the endpoint response, and into the nightly run detail so a night's skips are queryable afterwards.

## 2. Broken-recipe scan

### What I found

Recipes and their ingredients live in `inventory_recipe_ingredients` (recipe item → ingredient item, per location). Current live state:

```text
ingredient links pointing at a switched-off product ......... 979
recipes touched by those ................................... 223
distinct switched-off products involved .................... 216
of those recipes, how many are themselves switched ON ......   0
active recipes that have ingredients at all ................   3
```

So today the scan reports nothing — all 979 broken links belong to recipes that are themselves off (the freshly deployed, not-yet-activated catalogs). That is exactly why this check is worth having now: as stores activate their catalogs, a dish switching on while one of its ingredients stays off is the failure mode, and nothing currently notices.

### Where it should live — my recommendation

- **Logic:** one new function, `recipe-integrity-scan`, taking an optional location. Called at the end of deploy's activation sweep for that store, and added to the nightly pipeline as a per-store stage after `catalog_parity` (so it sees whatever parity just deployed and activated).
- **Storage:** a small table, `recipe_integrity_alerts` — one row per (location, recipe, missing ingredient), with the names snapshotted so the report reads correctly even if something is renamed later, plus first-seen / last-seen and a resolved stamp. The scan re-stamps existing rows and closes ones that healed, so the list never double-reports.
- **Surfacing:** a "Recipes missing ingredients" card in the existing **Health** tab of Brand Inventory (next to Vendor Health), grouped **by missing product** — product name, how many dishes it affects, and the full list of dish names, since one missing item commonly hits several dishes. A count badge on the Health tab so it's visible without opening it. Read-only: no disable button, no auto-disable, matching tonight's flag-only rule.

Alternative considered and rejected: folding this into `vendor_gap_alerts`. That table is shaped around vendor SKUs and brand-level review; recipe breakage is per-store and per-dish and would distort the gap list.

## Technical notes

- `supabase/functions/_shared/vendorPriceChase.ts` — per-item `try/catch` inside the `for (const item of items)` loop; capture `{ error }` on both `inventory_items` updates; pre-activation guards (`brand_item_id` present, brand template `status = 'live'` via one batched template-status lookup reusing the ids already loaded for `loadApprovedNumbers`); extend `ChaseSummary` with `skipped` + `skips: { itemId, name, reason, detail }[]`.
- `supabase/functions/vendor-price-chase/index.ts` — tolerant paging; pass through `skipped` / `skips`.
- `supabase/functions/vendor-sync-nightly/index.ts` — surface `skipped` in `price_fill` / `reactivation` / `catalog_parity` detail; add stage `recipe_integrity` (per location) to `STAGES` after `catalog_parity`, with its runner calling the new function.
- New: `supabase/functions/recipe-integrity-scan/index.ts` (service/manager caller guard, same pattern as `vendor-price-chase`); called from `deploy-location-inventory`'s Phase 2 completion path and from the nightly stage.
- Migration: `recipe_integrity_alerts` (location_id, brand_id, recipe_item_id, recipe_name, ingredient_item_id, ingredient_name, status, first_seen_at, last_seen_at, resolved_at) with grants, RLS (managers read, backend writes), and a unique key on (location_id, recipe_item_id, ingredient_item_id).
- UI: new `src/components/inventory/RecipeIntegrityCard.tsx` rendered in the Health tab of `src/pages/BrandInventory.tsx`; badge count on the Health tab trigger.
- No retroactive action on the 979 existing links beyond reporting them once their recipe is active — nothing is auto-disabled.

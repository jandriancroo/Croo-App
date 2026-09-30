# Recipe and raw-item costing fix, brand-wide, in phases with audits

Inventory is locked. Nothing is built until Jordan says "unlock please". Every change works from brand, with no store IDs in code or data fixes. Each phase ends with an audit, and the next phase only starts when it passes.

## Confirmed facts this plan relies on
- **Who can count:** counts and count lines are gated by `has_location_access(auth.uid(), location_id)` (policies on `inventory_counts` / `inventory_count_items`). Sandbox counts are gated by owner + super_admin.
- **Who can read pack data today:** `item_conversions` SELECT is super_admin or `brand_members` only.
- **The ×17 / ×7 multiplier is `pack_quantity`:** Palm Springs 17oz ball = 17, 6.8oz ball = 7, Prepped Dough = 668. That is each item's recipe yield rounded (17, 6.8→7, 667.5→668). No migration from Apr 30 sets it, so it was a runtime write. The writer is not yet identified; Phase 4 starts by finding it.
- **Pans:** dough balls have `dough_box` pans (8 and 20) at Hemet, Palm Desert, Palm Springs and Rowlett. Tuscaloosa and "[TEST] Sandbox" have none.
- **Recipe pan counting:** the count screen's recipe value path (`InventoryCountSession.tsx` 1019-1041) counts units as `getTotalQuantity(key, 1, pan_sizes)`, so pans are counted and the case multiplier is 1. The saved-line path (1523 / 2196, `pack_quantity_at_count`) still needs checking in Phase 0 to see whether the ×17 comes in there.

## Phase 0 — Baseline audit (read-only, partly done)
- **Checks:**
  - Every active recipe item at every store: `cost_per_unit`, yield, `pack_quantity`/`_override`/`count_units_per_case`, pans, and the value of 1 unit and 1 pan today.
  - Raw items Yeast, Sugar, Crushed Red Pepper and Tabasco: store price, pack, store selection, and what the count screen values 1 unit at.
  - The last 3 locked counts at PS/PD for dough balls: `quantity`, `entered_cases`, `pack_quantity_at_count`, `cost_at_count`. This confirms where the ×17 enters.
- **Still to finish at build time:** "value of 1 counted unit today" as the count screen computes it. That needs the brand pack setting each item currently resolves to, and the saved-line check above.

## Phase 1 — Pack data readable by anyone who can count, and loud failure
- **Change:** add a SELECT rule on `item_conversions`: `exists (select 1 from locations l where l.brand_id = item_conversions.brand_id and has_location_access(auth.uid(), l.id))`. Keep the existing edit rules.
- **Loud failure:** in `recipeCostCalculation.ts` (54-71), if the brand has recipe items and the conversions load returns an error or 0 rows, throw. The count screen then shows "Recipe prices unavailable" and blocks the lock.
- **Files:** one migration; `src/utils/recipeCostCalculation.ts`; the error handling around `InventoryCountSession.tsx` 435-437 and the lock button.
- **Time:** 30-45 minutes.
- **Could break:** a slower count-screen load. `has_location_access` is called per brand store, so it stays small.
- **Audit:**
  - Mint sessions for `d67a3a4b…` and `e856079b…`, then `select count(*) from item_conversions where brand_id = <Blaze>` through the app client. Expect more than 0.
  - A user with no store at the brand gets 0.
  - Force an error (bad brand id in a dev check) and confirm the lock button is disabled with the message.

## Phase 2 — Server calculator, dry run only
- **Change:** SQL function `compute_recipe_costs(_brand_id, _location_id default null)`. It is security definer, returns rows, and writes nothing. It returns a row per store recipe: old cost, new batch cost, per-yield-unit cost, brand yield, missing ingredients, unpriced ingredients.
- **Rules:**
  - Ingredients map from brand item to store item through `brand_item_id`, active only.
  - Case price = `blended_price`, else `cost_per_unit`.
  - When the brand conversion disagrees with the store's own pack (yeast), use the store's pack.
  - `ea`/`cn`/`ct` count as one unit of the pack, never 1 oz.
  - The oz table is copied from `unitConversion.ts`.
  - Sub-recipes use the brand recipe's yield. The function guards against loops.
  - Gaps are listed, never skipped.
- **Files:** one migration (function only).
- **Time:** 2-3 hours.
- **Could break:** nothing, because nothing is written. Pack strings the parser can't read appear as unpriced.
- **Audit:**
  - PS Prepped Dough $16.32 ±$0.02, 17oz ball ~$0.43, 6.8oz ball ~$0.19, Classic Red Sauce $24.41.
  - PD Prepped Dough within cents of PS.
  - Full table for every store of every brand with recipes: old vs new, plus gaps. Romaine should appear as "no recipe".

## Phase 3 — Write costs and the nightly schedule (after Jordan approves the Phase 2 table)
- **Change:**
  - `apply_recipe_costs(_brand_id)` writes `cost_per_unit`, plus new columns `cost_status` (`ok`/`incomplete`/`no_recipe`) and `cost_computed_at` on recipe items.
  - One nightly SQL-only pg_cron job runs about 30 minutes after vendor price sync and loops over brands.
- **Files:** a migration (the apply function and columns); the cron is set up directly.
- **Time:** 45 minutes, plus review.
- **Could break:** open counts reprice live. Locked counts are protected by `freeze_locked_count_snapshots`.
- **Audit:**
  - A dry run right after the write shows zero differences.
  - PS/PD Sept 1 `cost_at_count` rows: checksum before equals after.
  - `cron.job` shows one new job.

## Phase 4 — Recipe editor, pack reset, pans
- **Change:**
  - Find what wrote `pack_quantity` = rounded yield: git history of `RecipeBuilderDialog.tsx`, `DeployToLocationDialog.tsx`, `BrandItemActivation.tsx` (258 copies `pack_quantity` from the source), heal/deploy functions. Remove that write.
  - The editor's save paths (about 657-744, 756-779, 834-858) stop writing `cost_per_unit`, `count_units_per_case`, `pack_quantity`, and `count_unit = yieldUnit`. After saving, they call `apply_recipe_costs`.
  - **Data, all brands:** on active recipe items, set `pack_quantity`, `pack_quantity_override` and `count_units_per_case` to NULL (a recipe has no case). Set store yields to the brand recipe's yield.
  - **Pans:** store values untouched. If the saved-line path multiplies by `pack_quantity_at_count` for recipes, make recipe lines always snapshot 1 so pans × baseline_units is the only multiplier.
  - Tuscaloosa and the sandbox have no dough-box pan. Flag this for Jordan, since pans are store-owned and not added automatically.
- **Files:** `RecipeBuilderDialog.tsx`, whichever writer is found, `InventoryCountSession.tsx` (save paths 1523, 2196 for recipes), plus a data run.
- **Time:** 1.5-2 hours. Finding the writer is the unknown.
- **Could break:** Palm Springs counters used to entering "cases". They now enter balls or dough boxes, so tell the Palm Springs manager tonight.
- **Audit:**
  - Zero recipe items with any pack multiplier: `select count(*) from inventory_items where is_active and is_recipe and (coalesce(pack_quantity,1)<>1 or pack_quantity_override is not null or count_units_per_case is not null)` returns 0.
  - In a PS sandbox, 10 balls = 10 × per-ball cost, and 2 dough boxes = 16 (17oz) / 40 (6.8oz) × per-ball cost.
  - Re-save one recipe in the editor and confirm the pack fields stay empty.

## Phase 5 — Count screen raw items use the store's own pack
- **Change:** the count screen's brand pack setting (lens) comes from the store's `location_pack_selections`. With no selection there is no lens, and the store pack wins through `getEffectivePackQty`. It never uses "any approved brand config".
- **Files:** the lens loader in `InventoryCountSession.tsx`/its hook, found first.
- **Time:** 1.5 hours.
- **Could break:** items that relied on the brand setting change value. The audit lists them all.
- **Audit:**
  - Per-unit value equals store price ÷ units in the store pack:
    - Yeast: $6.87 per 1 lb bag
    - Sugar: $21.53 / 2000 packets
    - Crushed Red Pepper: $23.41 per 4 lb
    - Tabasco: $37.47 / 12 bottles
  - Each is checked at PS and PD.
  - A diff of every item's 1-unit value vs Phase 0, for every store of the brand.

## Phase 6 — Final end-to-end audit before PS/PD count
- **Check:**
  - A sandbox count at a PS copy, run as a store admin (not super admin, not brand member).
  - Compare every line to Phase 0 and the expected values.
  - Confirm lock works, and that frozen values equal the screen.
- **If any phase fails by tonight:**
  - Phases 1 and 5 are independent and can ship alone.
  - The Phase 4 multiplier reset can ship alone.
  - Without Phase 3, recipes use their April saved prices where they exist, and live prices elsewhere. With Phase 1 in, live prices are no longer inflated.

## Tier 2 — after Thursday (unchanged)
1. Brand recipe edits push to every store copy, and new stores get copies on deploy.
2. Retire the client calculators in favor of the server one.
3. Missing-ingredient flags on the count screen and item list, driven by `cost_status`.
4. Romaine recipe at brand level, pushed to all stores.
5. History decision: PS dough balls since May, PD Aug and Sep.

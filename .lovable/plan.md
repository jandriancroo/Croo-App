# Recipe and raw-item costing fix, brand-wide (every store of the brand)

Inventory is a locked feature. Nothing here starts until Jordan says "unlock please". Every step works from brand, so no store IDs are written into code or data fixes.

## Plain-language summary
- **Today, before Thursday:** let store managers read the brand's pack conversions. Build one recipe-price calculator that runs on the server and has the right unit math. Run it for every store tonight and every night after vendor sync. Stop the recipe editor from writing its own prices and pack sizes. Make the count screen price raw items from the store's own pack. Nothing ships unless it passes a price check at Palm Springs.
- **After Thursday:** brand recipe edits flow to every store, one calculator everywhere, warnings for recipes missing ingredients, a Romaine recipe, and a decision about past counts.
- **Honest risk call:** items 1, 2, 3 and 5 can be finished and checked today. Item 4 (the editor) is the riskiest. The safe version for today is to stop it overwriting cost and pack size. Rewiring it to the server calculator waits for Tier 2. Details below.

## Tier 1 — today (all stores of the brand)

### 1. Store users can read brand conversions, and the calculator stops if they can't load
- **Change:** new read rule on `item_conversions`. A user who belongs to any store of the brand (through `user_locations` → `locations.brand_id`) can read it. This copies the "Location users can read brand recipes" pattern. Read access only, no editing.
- **Client safety net:** in `src/utils/recipeCostCalculation.ts` (lines 54-71), if conversions return empty or error for a brand that has recipes, throw an error instead of falling back to `pack_quantity`. The count screen then shows "Recipe prices unavailable, don't lock yet" instead of saving a wrong price.
- **Files:** one migration; `recipeCostCalculation.ts`; the error message in `InventoryCountSession.tsx` (around the fetchRecipeCosts query at 435-437).
- **Could break:** nothing that works today. Wider read access is the goal. The loud error could block a count at a brand with no conversions, so it only fires when the brand has conversions but none came back.
- **Test:** log in as the two Sept 1 counters (admin and org_admin, no brand membership) and confirm conversions load. Check that the security checker is clean.
- **Time:** about 30 minutes.

### 2. One recipe-price calculator, run on the server
- **Change:** new database function `compute_recipe_costs(_brand_id, _location_id default null)`. It is SQL, security definer, and returns rows instead of writing them. A companion function `apply_recipe_costs(_brand_id)` writes the results.
- **Rules:**
  - Map ingredients from brand item (`vendor_item_id`) to the store item through `inventory_items.brand_item_id`, active items only.
  - Case price = store `blended_price`, else store `cost_per_unit`.
  - Units per case: use the store's own pack (`pack_quantity` × inner size parsed from `pack_size`) when it disagrees with the brand conversion. This fixes yeast, where the brand says 20 × 1 lb but the store buys 1/1 lb. Otherwise use the brand conversion.
  - `ea`/`cn`/`ct` count as one unit of the pack, never 1 oz. So 1 ea Goodie Bags = $45.71 ÷ 18 = $2.54.
  - Weight and volume go through the same oz table as `src/utils/unitConversion.ts`, copied into SQL once. Parity is checked by test.
  - Sub-recipes are priced per unit of the **brand** recipe's yield (`recipe_blueprints.yield_qty/unit` of the brand original). The function guards against loops.
  - It returns `missing_ingredients` and `unpriced_ingredients` arrays per recipe and never skips silently. A recipe with gaps gets its cost written with a `cost_status = 'incomplete'` flag (new nullable column on `inventory_items`).
- **Files:** one migration (functions plus the `cost_status`, `cost_computed_at` columns).
- **Could break:** unusual pack strings the parser can't read. Those land in `unpriced_ingredients` instead of guessing.
- **Test:** the verification gate below, plus a Palm Desert run where Prepped Dough must match Palm Springs within cents.
- **Time:** 2-3 hours. This is the core of the work.

### 3. Run it for every store now, and nightly after vendor sync
- **Change:**
  - First run `compute_recipe_costs` without writing, for every brand with recipes, and show the before/after table.
  - After Jordan approves the table, run `apply_recipe_costs` for every brand.
  - Add one nightly pg_cron job about 30 minutes after the existing vendor price sync. It is SQL only, with no web calls.
- **Files:** a data run, plus the cron schedule, which is set up directly and not as a migration.
- **Could break:** locked past counts are safe. `cost_at_count` is frozen by `freeze_locked_count_snapshots`, and open counts keep the price already saved on their lines.
- **Test:** re-run the dry run and expect no differences. The cron log should show one run.
- **Time:** about 30 minutes, plus Jordan's review.

### 4. The recipe editor stops overwriting cost and pack size
- **Change for today (safe version):**
  - In `src/components/inventory/RecipeBuilderDialog.tsx` save (around 657-744) and the heal/create paths (756-779, 834-858), stop writing `cost_per_unit`, `count_units_per_case`, and `count_unit = yieldUnit`.
  - After saving, call `apply_recipe_costs` for that brand, so the server price is written.
  - The editor keeps showing its own live preview number, labeled "estimate".
- **Data reset (all brands):**
  - Set `count_units_per_case = 1` on every active item with `is_recipe = true`.
  - Set every store item's `recipe_yield_qty/unit` to its brand recipe's yield.
- **Deferred to Tier 2:** replacing the editor's preview math with the server function.
- **Could break:**
  - Counters who learned to enter dough balls as "cases" of 17 will now count one per unit. Tell Palm Springs tonight.
  - Also check that `DeployToLocationDialog.tsx` (~882) doesn't copy the old value back.
- **Test:** edit and save a test recipe as an admin. Confirm the pack size stays 1 and the price matches the server.
- **Time:** about 1.5 hours.

### 5. Count screen prices raw items from the store's own pack
- **Change:**
  - Where the count screen builds the brand pack setting for each item (the lens passed into `getEffectivePackQty` / `calculateCountItemValue`), resolve it through the store's `location_pack_selections` first.
  - If the store has no selection, use no brand setting at all, so the store's own pack wins (existing fallback order in `src/utils/getEffectivePackQty.ts`).
  - Never pick "any approved" brand setting.
- **Files:** the lens-loading hook/query used by `InventoryCountSession.tsx`. Its exact spot gets confirmed first. It's the non-deterministic lookup from this morning's finding.
- **Could break:** items whose right number only lived in the brand setting will switch to the store pack. The dry-run table lists every item whose value changes, so none change silently.
- **Test:** at Palm Springs and Palm Desert, the per-unit prices for Yeast, Sugar, Crushed Red Pepper and Tabasco must equal invoice price ÷ units counted.
- **Time:** about 1.5 hours.

## Verification gate (must pass before telling PS/PD to count)
- Palm Springs server results: Prepped Dough $16.32 (±$0.02), 17oz ball ~$0.43, 6.8oz ball ~$0.19, Classic Red Sauce $24.41.
- Yeast, Sugar, Crushed Red Pepper and Tabasco priced at what the store pays per counted unit.
- One sandbox count at Palm Springs, logged in as a non-brand-member admin, showing the same numbers.
- Per-store table for every brand store: recipe item, old cost, new cost, pack size old → new, missing/unpriced ingredients.

**If the gate fails by tonight:**
- Ship items 1 and 5 alone. They are small and independent.
- Recipe items then count at their saved April prices at Hemet/PS, and live-calculated prices at PD. With item 1 in place, PD's are no longer inflated.
- Palm Springs dough balls would still be ×17/×7 unless the pack-size reset from item 4 runs, and that reset is safe on its own.

## Tier 2 — after Thursday
1. Brand recipe edits push to every store copy automatically, and new stores get copies when deployed.
2. Retire the client calculators (`blueprintCostCalculation.ts`, the editor's own math, and `fetchRecipeCosts`'s math). All three read server results.
3. "Recipe missing ingredients" flag on the count screen and item list, driven by `cost_status`.
4. Build Chopped Romaine's brand recipe, turn it on, and push it to all stores.
5. Decide with Jordan: correct frozen history (PS dough balls since May, PD Aug and Sep) or leave it with a note.

## Technical notes
- New rule on `item_conversions`: SELECT to authenticated using `brand_id in (select l.brand_id from locations l join user_locations ul on ul.location_id = l.id where ul.user_id = auth.uid())`.
- Functions are `security definer`, `set search_path = public`, and check `has_role_or_higher` or brand membership before writing.
- Cron: one job, daily, SQL only, loops over brands with active recipe items.
- No `sales_cache`/`labor_cache` impact. Past locked counts are never touched.

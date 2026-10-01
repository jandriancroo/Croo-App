# Brand to store recipe fix (plan only)

Nothing is saved until Jordan approves each gate.

## What the code and data show

**1. Brand Edit Recipe page: where each field comes from**

The brand page opens the recipe catalog for whichever store is picked in the store selector. It defaults to the first store, which is Hemet (`BrandInventory.tsx:89, 224, 668`).

| Field | Reads from | Saves to |
|---|---|---|
| Name, category, yield | Brand blueprint (`RecipeBuilderDialog.tsx:351-355, 501-505`) | Brand blueprint (`:698-706`). For counted recipes it also saves to the linked **store** item (`:728-733`) |
| Ingredients | Brand blueprint ingredients (`:358-361`). Display names come from the selected store's items (`:511-515`) | Deleted and re-added on the brand blueprint (`:710-721`) |
| Counted toggle | Whether a linked store item exists (`:366-372, 506`). It **never reads** `recipe_blueprints.is_countable` | Never writes `is_countable`. "On" creates or updates a store item through `heal_orphan_blueprint`, using the selected store (`:736-746`). "Off" turns the store item off (`:748-750`) |
| Pans | The linked store item's pans (`:507`) | The store item's pans (`:732, 745, 795`). Nothing is saved at brand level |

Checked in the data: the brand Prepped Dough recipe (a243cfef) has counted = true and no linked item. The brand Romaine recipe (710e123b) has counted = false and no linked item. The Prepped Dough brand template has a source store set (Hemet). Its Hemet item has counted = false and no pans. So yes: the page shows store values, not the brand's own values.

Not confirmed yet: how the page reached Hemet's Romaine item, given the brand recipe has no linked item. Romaine's brand item uses a different name, so my name-based check missed it. Step 0 below confirms this before any build work.

**2. Every place brand recipe data lives today**
- Brand recipes (`recipe_blueprints` with no store) and their ingredients: name, yield, ingredients, `is_countable`.
- Brand items (`brand_inventory_templates`): the counted output for each recipe. These carry `source_location_id` and `vendor_source = 'recipe:<Hemet recipe>'`, which point back to Hemet.
- Hemet's own recipe copy and its store item: currently acts as the brand's counted toggle and pans.
- Every store's recipe copy, made once by migration `20260502034538` (lines 70-80 match items through Hemet).
- `item_conversions`: brand pack sizes, used by recipe costing.

**Proposed single brand source:** brand recipes plus their ingredients for name, yield, ingredients and counted. The brand item for each counted recipe holds the recipe pans and their capacity. Store items hold only which pans are on, plus pans for ordinary vendor items. `item_conversions` stays a fallback for pack sizes only.

**3. Recipe costing pack size today**
`_rc_batch` (migration `20260930194343`, about lines 115-170) takes the price from the store item. It takes the pack from `pack_size`/`pack_quantity`, falling back to the latest `item_conversions` row (`outer_qty × canonical_qty_per_inner`). It does **not** read `get_store_pack_lens` / `v_store_pack_lens`, so recipe costing and the count screen use different pack sizes. That explains the Yeast case: 20 lb case vs the 1 lb bag, $0.03 vs about $0.53 for 35 g.

**Switch:** join `get_store_pack_lens(_location_id)` on the brand item. If the store has a pack choice, divide the price by that pack (lens count units × common unit converted to oz, or count for ea/cn). If there is no pack choice, keep today's pack source. Flag a recipe in "unpriced" when the pack size and unit cannot be matched.

## The fix, in order

**0. Confirm (read only):** trace how Romaine reaches Hemet's item. List every brand recipe's counted value, linked item and pans, next to Hemet's.

**a) Brand page uses only brand records**
- The dialog reads and saves counted from `recipe_blueprints.is_countable`. Pans are read and saved on the brand item.
- In brand mode it never creates or edits store items. It no longer depends on the selected store, except for showing prices.
- The new Hemet links (`source_location_id`, `recipe:` vendor source) are no longer read. Hemet becomes an ordinary store.

**b) One-time brand cleanup (Jordan confirms each row)**
- A table of every brand recipe where the brand record differs from what the page shows today. Columns: recipe, field (counted / pans / yield), brand value, page (Hemet) value, proposed value.
- Jordan picks the correct value on each row. Nothing is saved without that row being confirmed. Old values are archived.

**c) Brand to store recipe sync**
- Runs on every brand save, plus one nightly check (scheduled database job, no web calls).
- Updates only store recipes copied from the brand. Each copy gets a brand-recipe link, filled in during setup with a match report for review.
- Pushes yield, ingredients, counted, and recipe pans with brand capacity. The store keeps its on/off choice for each pan; new brand pans start on.
- Store-only recipes are never touched. Every change is logged, and locked counts keep their frozen snapshots.
- This also fixes Tuscaloosa's missing dough-box pans through the per-store rescan agreed earlier, not a one-off fix.

**d) Costing uses each store's pack.** Apply the switch from item 3 to `compute_recipe_costs` / `apply_recipe_costs` and the dry-run calculator.

**e) Simulation before saving**
- For every store: which recipes change, old vs new cost per unit, and the reason (pack, yield or ingredients).
- Palm Springs and Palm Desert each get their own table. Yeast must move to about $0.53 per 35 g.
- Stop if any unexpected Palm Springs or Palm Desert value changes. Save only after Jordan approves.

## Gates
Step 0 → a → b (Jordan confirms the table) → c and d built with saving off → e simulation → Jordan approves → save. No publishing.

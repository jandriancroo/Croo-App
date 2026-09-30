# Recipe item cost: brand to store — traced answer (read-only)

Nothing was changed. Everything below comes from reading the code or querying the data. Math marked "traced by hand" follows the code line by line using today's prices. The code itself was not run.

Heads up: every fix below touches Inventory, which is locked. Nothing gets applied until you say "unlock please".

---

## 1. What writes a recipe item's saved cost (`cost_per_unit`)

There is no scheduled job, no database trigger and no background function that recalculates recipe cost. Checked every database function and every scheduled job: none write `cost_per_unit` for recipe items. Only three code paths do:

| Writer | When it runs |
|---|---|
| `RecipeBuilderDialog.tsx` save (lines ~657-744) | Only when someone opens the recipe editor and hits Save. It writes the batch cost, plus `recipe_yield_qty`, `count_unit` and `count_units_per_case = yield`. |
| `DeployToLocationDialog.tsx` ~882 | Manual brand deploy. It copies the source item's cost onto the target recipe item. It does not calculate anything. |
| Vendor/invoice price syncs (PFG, PA, invoice upload) | These write only vendor-matched items, never recipe items. |

**Why the costs date from Apr 27-30:** the recipe editor was saved then, which also rewrote yields and pack sizes. That's the only writer that sets all those fields together. There's no audit log for it, so who saved and what they clicked can't be confirmed. Since then nothing has run again.

**The hidden second path:** saved cost isn't the whole story. `fetchRecipeCosts()` (`src/utils/recipeCostCalculation.ts`) runs live on the count screen and in reports:
- If the saved cost is above $0, it uses the saved cost as-is (line 214). So Hemet and PS still use April numbers.
- If the saved cost is empty, it works the cost out live from ingredients. So PD and Red Sauce are costed live at count time.
- When a count is saved, that result is frozen into `cost_at_count` (`InventoryCountSession.tsx` line 1523).

## 2. How an ingredient's store price becomes a cost per recipe unit

This happens in `calculateBatchCost()` inside `fetchRecipeCosts()`, lines 252-305.
- **Price:** the store item's `blended_price`, or else its `cost_per_unit` (the case price).
- **Units per case and base unit:** taken from the brand's active `item_conversions` row (outer × inner), with `canonical_unit` as the base unit. It only falls back to the store's `pack_quantity` / `count_unit` when no brand conversion exists.
- **Not used:** the brand pack settings (`brand_pack_configs`) and the store's `pack_size` (except as a last resort when there's no unit at all).
- **Unit conversion:** uses the shared table in `unitConversion.ts` (g 0.03527, lb 16, gal 128, qt 32, ea 1, cn 1).

| Recipe unit | How it's handled |
|---|---|
| cs | Case price × qty |
| cn (can) | Has its own branch (line 276): case price ÷ `outer_qty` × cans, used when the brand conversion's inner size isn't 1. Red sauce cans resolve correctly: $37.62 ÷ 6 × 3 = $18.81. Cans do **not** break the chain. |
| g, oz, gal, lb | Converted to the base unit, then × (case price ÷ units per case) |
| ea | **Bug.** When the base unit is oz, 1 ea is treated as 1 oz. Goodie Bags: 1 bag costs $0.069 instead of $2.54. |

Sub-recipes (dough ball → Prepped Dough) take the sub-recipe's batch cost ÷ its yield, with unit conversion (lines 231-250).

## 3. Yeast, and what Prepped Dough should cost at Palm Springs

- Prepped Dough's cost does **not** read the brand pack settings. It reads `item_conversions`, which also says 20 × 1 lb for yeast. The store's yeast is a 1 lb bag at $6.87 (`pack_size` 1/1 LB, `pack_quantity` 1). The code divides $6.87 by 20, so 1 lb is costed at $0.34.
- So yes: brand conversion mistakes leak straight into recipe cost. Pack-settings mistakes don't, because recipe costing never reads them.

Prepped Dough at PS, today's prices (traced by hand):

| Ingredient | Correct | What the code gives |
|---|---|---|
| Flour 1 cs | $10.73 | $10.73 |
| Water 2 gal | $0 | $0 |
| Yeast 35 g | $0.53 | $0.03 (÷20 mistake) |
| Goodie Bags 1 ea | $2.54 | $0.07 (ea = 1 oz bug) |
| EVOO 9 oz | $2.52 | $2.52 |
| **Batch** | **$16.32** | **$13.34** |

PS's saved $13.53 is close to the buggy path, though it used April prices. Hemet's $16.03 is close to correct.

## 4. Why Palm Desert is empty but Hemet and PS are filled

The recipe editor was never saved at PD. That's the only thing that writes the cost, and it's also why PD's yields still match the brand (1 ea, 45 lb). The yield difference is a result of this, not the cause.

Because PD's cost is empty, PD gets costed live, with the yeast and Goodie Bag bugs.

On the **Sep 1** count, PD's frozen values were $5.64 per 17 oz ball, $4.28 per 6.8 oz ball, $1,633.87 for Prepped Dough and $3,601.81 for Red Sauce. These don't match today's math, and I can't rebuild them because prices and settings from that day aren't stored. They're far too high: 24 × $5.64 + 110 × $4.28 = **$606** for dough balls alone.

## 5. Classic Red Sauce

- Costing does **not** skip menu-type or not-countable recipes. `fetchRecipeCosts` finds recipes by what they produce and never checks type. Red Sauce already costs live at **$24.41 per 22 qt batch** today ($18.81 cans + $5.60 EVOO + $0 water). Changing it to prep wouldn't change the price.
- It's empty only because the recipe editor never saved a cost for it.
- A counted item coming from a menu-type recipe is a **data error.** The recipe editor turns off the counted item when a recipe is not countable (line ~733), so a live counted item with a menu recipe can only come from an older path or a direct data change.
- Sep 1's frozen $3,601.81 can't be explained. Quantity was 0, so it added $0.

## 6. Chopped Romaine

- `recipe:f9677056…` is the ID of a **Hemet-only, menu-type recipe with 1 ingredient**. It produces item `4979638a`, which is now switched off (it had cost $6.70). The brand item was created from it by `heal_orphan_blueprint` (migrations stamp `vendor_source = 'recipe:' || blueprint id`).
- There's also a brand-level romaine recipe `710e123b` (1 ingredient) that isn't linked to any store item.
- The active romaine items at all three stores have no linked recipe, so the cost works out to **$0**.
- There is no old-style recipe in `inventory_recipe_ingredients` (0 rows).

## 7. Who owns what

- **Recipe, ingredients and yield:** each store has its own copy, edited separately. Deploy (`deploy-location-inventory` lines 435-437) copies the brand yield only when the item is first created. After that, the recipe editor overwrites it per store (e.g. PS 667.5 oz vs 45 lb). Nothing re-syncs it.
- **Cost:** ingredient prices are per store. Recipe cost is either saved per store or worked out live.
- **Intended source of truth:** under the Brand-Centric rule, the brand should own recipe, ingredients and yield, and stores should own only prices. Today the code doesn't enforce that.

## 8. Count impact (latest count: Sep 1, locked)

**Palm Springs, Sep 1.** Dough balls were counted as "cases": 60 and 192. Pack sizes were 17 and 7, because the recipe editor copied the **yield** (17 oz / 6.8 oz) into units per case. So the saved quantities became 1,020 and 1,344 balls.

- Sep 1 value: 1,020 × $0.408 + 1,344 × $0.163 = **$636**
- If 60 and 192 were actually balls, correctly costed: 60 × $0.43 + 192 × $0.19 = **$62**
- I can't tell from the data which one staff meant. That's a question for PS.

**Palm Desert, Sep 1.** 24 and 110 balls.
- Frozen value: **$606**
- Today's code would give: $26
- Correct: 24 × $0.43 + 110 × $0.19 = **$31**

Prepped Dough, Red Sauce and Romaine were all counted as 0 at both stores, so they added $0.

On Oct 1, if nothing changes:
- **PS:** April costs, plus the risk of the "case = 17 balls" mix-up.
- **PD:** today's live buggy costs (about 16% low on dough).
- **Both:** Red Sauce at $24.41 per "each" (one each = one full 22 qt batch), and Romaine at $0.

## 9. Fixes

**Smallest safe fix before Oct 1 (data only, needs "unlock please"):**
1. Save correct batch costs at PS and PD:
   - Prepped Dough $16.32
   - 17 oz ball $0.43
   - 6.8 oz ball $0.19
   - Red Sauce $24.41

   Because saved cost wins, this skips the yeast and Goodie Bag bugs for this count.
2. Set PS dough balls' units per case to 1, so "case" can't multiply balls by 17. Also, 17 oz / 6.8 oz are ball weights, not how many balls come in a batch — reset them to the brand's 1 ea.
3. Set PS Prepped Dough yield back to the brand's 45 lb.
4. Romaine: either link it to the brand romaine recipe (`710e123b`), or accept $0 for this count and flag it.
5. Past locked counts stay untouched. Sep 1's frozen numbers are protected on purpose.

**Before step 1, I need from you:** did PS staff enter 60 and 192 **balls** on Sep 1, or trays?

**Lasting fix (after Oct 1):**
- **One server-side recalculation of recipe cost**, run nightly after vendor price syncs and whenever an ingredient's price changes. The count screen reads only that saved result, not the April numbers or a separate live calculation.
- **Fix the unit math:**
  - Treat "ea" as one pack of the store item (outer ÷ inner), not 1 oz.
  - Prefer the store's own pack (`pack_quantity` / `pack_size`) when it differs from the brand conversion (yeast: 1 lb bag, not 20).
- **The brand owns yield and recipe:**
  - Store copies re-sync on deploy.
  - The recipe editor stops copying yield into units per case.
- **Guard rule:** a counted item can't come from a menu-type recipe.
- **Cleanup:** remove duplicate brand pack settings rows (yeast has both 20/lb approved and 1/lb archived).

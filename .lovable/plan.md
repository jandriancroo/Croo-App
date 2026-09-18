# Investigation: Hemet's 745 items, menu recipes, and the deploy rule

Read-only. Nothing changed.

## Question 1 — Hemet's 745 rows

Hemet is not carrying 500 extra brand items. It is carrying **438 rows imported from R365** (`source = 'r365_import'`) that exist at **no other location**, plus a normal-sized brand set.

Breakdown of all 745 rows at Hemet:

| Group | Rows | Active | Linked to a brand item |
|---|---|---|---|
| R365 import — recipes | 225 | 0 | 2 |
| R365 import — non-recipes | 204 | 0 | 0 |
| R365 import — non-recipes (active) | 9 | 9 | 9 |
| Normal store items (`source = 'manual'`) — active | 169 | 169 | all linked |
| Normal store items — inactive | 131 | 0 | 108 linked |
| Recipes (brand-deployed) | 7 | 5 | all linked |

Two import batches, both Hemet-only: **Mar 13 2026** (225 rows) and **Mar 22 2026** (215 rows). Names in those batches are menu dishes and menu modifiers — "vegan pizza", "spicy double pepperoni", "$1 meatball", "- cat - basic signature boxed lunch", "stawberry margarita", "[ARCHIVED] classic prep red sauce". This is a one-time R365 menu/recipe import, not repeated deploy runs: `brand_auto_deployment_log` has **zero rows** for Hemet, and every other store has **zero** `r365_import` rows.

- **Orphans:** 0. No Hemet row points at a deleted brand template, and 0 rows carry `brand_archived_at`.
- **Duplicates:** 54 brand items appear on two rows each (54 extra rows). **None of those 54 has more than one active row** — in every case one row is active and the other inactive. So no double-counting.
- **Unlinked:** 450 rows have no `brand_item_id` — 429 of them are the R365 import.
- **Are they polluting counts?** Historically yes, currently no. 215 of the R365 rows appear in count sessions, but the last count touching an **inactive** R365 row was **Apr 12 2026**; the last count touching an inactive manual row was **May 31 2026**. Only the 9 active R365 rows appear in the last 90 days (24 count rows). Hemet's most recent count is Jul 4 2026.

**Verdict:** dead weight, not live pollution — with one caveat worth a decision: 9 of the R365 rows are still **active** and do show on count sheets. Whether those 9 are legitimate items someone kept on purpose or leftovers is a judgment call, not something the data settles.

## Question 2 — menu dishes deploying as inventory

The brand template list is **not** full of menu dishes. Of the 275 non-archived templates, only **8** are `is_recipe = true`:

| Template | Status | Yield |
|---|---|---|
| 17oz Dough Ball | live | 1 ea |
| 6.8oz Dough Ball | live | 1 ea |
| Chopped Romaine Hearts | live | 4.25 lb |
| Classic Red Sauce (Prepped) | live | 22 qt |
| Prepped Dough | live | 45 lb |
| (NEW) Balsamic Caramelized Onion | archived | 37 oz |
| Classic Red Sauce OLD | archived | 16 qt |
| 11" Pepperoni Pizza | archived | 12.8 oz |

All five live ones are genuine prepped items, and those five are exactly the five active recipe items at every store (Hemet, Palm Desert, Palm Springs, Rowlett, Tuscaloosa; South Meadows has them inactive). **Zero menu dishes are active as inventory anywhere.** The one true menu dish that reached the brand list — 11" Pepperoni Pizza — is `status = 'archived'`, so it never deploys.

**On the distinguishing field:** `brand_inventory_templates` has no field that separates a prepped item from a menu dish. `is_recipe` is one flag for both, and every one of the 8 has a `recipe_yield_unit`, so yield doesn't separate them either. That is the finding — but the live recipe system already solves it. `recipe_blueprints` carries `recipe_type` and `is_countable`:

| recipe_type | is_countable | Active | Inactive |
|---|---|---|---|
| menu | false | 253 | 94 |
| prep | true | 39 | 0 |
| sub_recipe | false | 1 | 1 |

Clean and complete: 39 countable prep recipes, 253 menu recipes, no overlap, no nulls. **`recipe_blueprints.recipe_type` + `is_countable` is the correct source of truth for what may deploy.**

## Question 3 — the actual deploy rule

One rule, one filter: **`status = 'live'`**.

- The trigger `auto_deploy_brand_template` fires when a template's status becomes `live` (insert or update) and calls the deploy job **once per location** where the location is active and `inventory_enabled = true`.
- The deploy job selects brand templates with `.eq("brand_id", …).eq("status", "live")` — nothing else. No category filter, no vendor-availability filter, and **no `auto_deploy_enabled` check**.
- `auto_deploy_enabled` is respected in exactly one place: the nightly availability sweep, when it auto-deploys missing recipe ingredients (`status = 'live'` AND `auto_deploy_enabled = true`). The main deploy path ignores it.
- Current values across the 275: **`auto_deploy_enabled = true` on all 275. Not one is false.** So even where it is read, it filters nothing today.

This also explains your first column. Of the 275 templates with `archived_at IS NULL`, only **219** are `status = 'live'` (214 items + 5 recipes); **52 are `status = 'archived'` while `archived_at` is still NULL**, plus 4 drafts. 219 live is what a clean store carries — which is exactly the 219–225 range every store except Hemet shows. The "275" in your table counts 52 templates that are archived by status but were never stamped with an archive date.

## Unproven

Why the 52 templates have `status = 'archived'` with a NULL `archived_at` — the two archive markers disagree and I did not find the write path that leaves them out of sync. Reporting it as a data inconsistency, not a diagnosed bug.

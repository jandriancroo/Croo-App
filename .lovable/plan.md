# Two cleanup jobs — Hemet R365 cruft, and the missing archive dates

All numbers below are live reads. Nothing changed.

## Job 1 — Hemet's R365 import rows

### The exact split

| Group | Rows | Plan |
|---|---|---|
| Active, in use (the 9 you listed) | 9 | Leave completely alone |
| Inactive, **has** count history | 215 | Keep the row, hide it from everything current |
| Inactive, **zero** count history ever | 214 | Safe to delete after one preparation step |
| Total `r365_import` at Hemet | 438 | |

### What a delete would touch

19 tables point at `inventory_items`. For the 214 zero-history rows, only one has any rows at all:

- `inventory_recipe_ingredients` — 345 rows where the doomed item is the recipe, and 193 rows where it is an **ingredient of another recipe** (90 distinct items). Every one of those 193 links belongs to a parent recipe that is itself one of the doomed inactive R365 rows — no live recipe depends on any of them.
- All other 18 tables: **zero rows**. Nothing in count legs, item locations, transfers, waste, spot counts, usage rates, invoice matches, checklist prep rows/completions, blueprints, deployments, integrity alerts, sandbox flags, or brand template source links.

One catch: the ingredient side of that link is a **restrict** foreign key, so it blocks a plain delete. The fix is ordering, not force:

1. Delete the `inventory_recipe_ingredients` rows for the 214 (both roles — 538 rows total, all self-contained to this set).
2. Delete the 214 `inventory_items` rows.

Both steps scoped to Hemet, `source = 'r365_import'`, `is_active = false`, and "no row in `inventory_count_items`". I'd run it as a single migration inside one transaction, with a before/after count in the migration so the numbers are on record.

### The 215 with count history

These are not deleted. There is already an established pattern for "keep the row, hide it": **`user_hidden = true`**, which the app uses as a hard filter — the items manager, Start Count, the daily spot check, the unit matrix and the produce sync all query `user_hidden = false`. It sits alongside `is_active`, so a row can be inactive *and* hidden, which is exactly the state we want. No new column, no new mechanism.

So for the 215: set `user_hidden = true` and stamp `deactivated_reason = 'R365 import cleanup — retained for count history'` (that field is already used for human-readable reasons elsewhere). They stay joinable from `inventory_count_items`, so past counts, variance and food cost are untouched.

### The 9 keepers — links are valid

All 9 point at a `brand_inventory_templates` row that is **`status = 'live'`**, and in all 9 cases the brand product name matches the local name exactly. Item numbers match on 8 of 9; **Sprite Bottle 20oz** has a different item number locally than on the brand template. Recommendation: leave all 9 exactly as they are, and look at Sprite Bottle 20oz separately — one mismatched vendor number is a data question for whoever set it, not something to auto-correct in a cleanup.

## Job 2 — the archive date

### What is actually going on

`archived_at` is not drifting. It was **never populated in the first place**. It was added on Jun 30 2026 in a migration that set it on exactly **one** template (the mislabeled meatball bucket) — there was no backfill. Live counts for the brand: **276 templates, 53 with `status = 'archived'`, and exactly 1 carrying an `archived_at`.** So the 52 nulls are every archived template except that one.

And the field is read nowhere. `archived_at` does not appear in a single line of app or function code outside the generated types file. Everything reads **`status`**:

- Archiving is written in three places, all in the brand UI: `src/pages/BrandUnpricedIngredients.tsx` (line 88), and `src/pages/BrandPackConfigApprovals.tsx` (lines 877 and 1100). All three set `status: "archived"` and none sets a date.
- Reading "is this archived" is `status`-based everywhere: the deploy job (`deploy-location-inventory`) selects `status = 'live'`, the nightly availability sweep filters `status = 'live'`, and the brand screens filter on `status`.

**So `status` is the field the system runs on, and there is no inconsistency between the two — one field is used, the other is dead.** That also explains the "275" in your earlier table: filtering on `archived_at IS NULL` counts 52 archived templates as if they were live. The real deployable set is **219 live** templates, which is why every clean store sits at 219–225.

### Recovering a date

`updated_at` is the only candidate, and it is only fair evidence. The 52 rows span Apr 7 to Aug 23 2026 in a pattern that looks like real archiving activity (17 on Apr 7, 13 on Apr 21, 8 on Aug 23, singles in between), and not one of them was updated on its creation day. But `updated_at` moves on *any* edit, so for a template touched after being archived the date would be too late. There is no audit log for this table to cross-check against.

My recommendation: **use `updated_at` as the archive date for all 52**, and record honestly that it is an approximation by also stamping a marker so nobody later mistakes it for an observed event. Two workable ways to mark it — your call:
- add a short comment on the column noting pre-Sep-2026 dates are inferred from `updated_at`, or
- stamp one universal date instead (`2026-08-23`, the last real archiving day) if you'd rather have one obviously-synthetic value than 52 plausible-but-approximate ones.

I lean toward `updated_at`: for most of these it will be right or within days, and the alternative throws away real signal.

### Stopping the drift

Two changes, both small:

1. **A database trigger** on `brand_inventory_templates`, before insert or update: when `status` becomes `'archived'` and `archived_at` is null, set `archived_at = now()`; when status moves back off `'archived'`, clear it. A trigger covers every path — the three UI paths today plus anything added later — which code-level fixes cannot guarantee.
2. Optionally also set `archived_at` explicitly in the three UI archive calls, so the intent is visible in the code. Not required once the trigger exists.

I would **not** switch any read path from `status` to `archived_at`. `status` works, it's used consistently, and changing what "archived" means across the deploy trigger, the deploy job and the sweep is a much bigger and riskier change than this job needs.

## Technical summary of the proposed migrations

**Migration A — Hemet cleanup (one transaction)**
1. `UPDATE inventory_items SET user_hidden = true, deactivated_reason = 'R365 import cleanup — retained for count history'` where Hemet + `source='r365_import'` + `is_active=false` + EXISTS a row in `inventory_count_items` → expect 215 rows.
2. `DELETE FROM inventory_recipe_ingredients` where `recipe_item_id` or `ingredient_item_id` is in the zero-history set → expect 538 rows.
3. `DELETE FROM inventory_items` for the zero-history set → expect 214 rows.
4. Never touches `is_active = true` rows.

**Migration B — archive dates**
1. `UPDATE brand_inventory_templates SET archived_at = updated_at WHERE status='archived' AND archived_at IS NULL` → expect 52 rows.
2. New trigger function keeping `status` and `archived_at` in step from now on.

## Stated plainly

- Deleting the 214 is safe once their recipe-ingredient links go first; nothing else in the database references them.
- The 215 with history are never deleted; `user_hidden` is the existing mechanism and needs nothing new.
- The 9 keepers are correctly linked to live brand templates and should be left alone.
- The archive-date "drift" is really a column that was never wired up; `status` is the real field, and the trigger is what stops it happening again.

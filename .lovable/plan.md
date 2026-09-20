# vendor_source mislabeling — root cause report (investigation only)

## Answer first

The 149 Palm Springs "manual" rows were never labeled by any code. They took the **column default**. Migration `20260218040538` (Feb 18 2026, 04:05 UTC) added the column as:

```sql
ADD COLUMN IF NOT EXISTS vendor_source TEXT DEFAULT 'manual';
-- then: UPDATE ... SET vendor_source='pfg' WHERE qubeyond_item_id IS NOT NULL AND vendor_source='manual';
```

The backfill only rescued rows carrying a legacy `qubeyond_item_id`. Every row inserted afterwards by a path that simply omits the field silently becomes `'manual'`. 129 of the Palm Springs rows were inserted the same evening, 2026-02-18 22:48–22:49 UTC — hours after the column landed, by the PFG order-guide import shipped at 20:17 that day, which did not set the field.

**The default is still `'manual'` in the live database today, and at least one live path still omits the field.** So a backfill alone would let this recur.

## 1. Every path that writes `inventory_items.vendor_source`

| Path | Writes | Condition |
|---|---|---|
| Column default (live today) | `'manual'` | any insert that omits the field |
| `deploy-location-inventory` | `tmpl.vendor_source`, else `pfg` if a PFG mapping exists, else `produce_alliance` if a PA mapping exists, else NULL | brand-catalog deploy (correct since Apr 19) |
| `produce-alliance-service` | `'produce_alliance'` | PA catalog upsert |
| `RemapItemDialog` (UI) | `'pfg'` | item replaced from PFG search |
| `DeployToLocationDialog` (UI) | `tmpl.vendor_source` verbatim (NULL when the template has none) | location-to-location deploy / auto-created recipe ingredients |
| `BrandItemActivation` (UI) | **nothing** — stamps `item_number` / `pa_item_id` only | brand item turned on at a store → default `'manual'` |
| `inventory-availability-sweep` auto-deploy | **nothing** | nightly missing-ingredient deploy → default `'manual'` |
| `create_item_from_recipe_blueprint` (SQL fn) | `'recipe:<blueprint id>'` | prep/recipe items |
| `VendorGapFinder` (UI) | `pfg` / `produce_alliance` / `invoice:<vendor>` | writes **brand templates**, not store items |

No code anywhere writes the literal `'manual'`. Every `'manual'` row in the database came from the default.

## 2. Was the column added after these rows? — Confirmed

Yes, and with `DEFAULT 'manual'`. SQL above. Hemet still holds 41 rows from the same era with the same fingerprint (36 carry PFG numbers).

## 3. Is it still wrong today?

Partly fixed, partly still broken.

- **Fixed (Apr 19, commit `552a0764b`):** `deploy-location-inventory` now derives the vendor from `brand_vendor_mappings` when the template's own value is blank. Before that it wrote `tmpl.vendor_source` verbatim — which is exactly the 18 Palm Springs NULL rows from Apr 11–17 (44 brand templates created Apr 1–3 have a NULL vendor_source to this day).
- **Why Palm Desert is clean:** it was deployed Apr 17 through the brand-catalog path against templates that by then had `vendor_source` populated (177 `pfg` / 30 `produce_alliance`), so it inherited the right value. Palm Springs predates the brand template catalog entirely — the first template was created Feb 23, five days after those 129 items.
- **Still wrong today (two paths):**
  1. `inventory-availability-sweep` auto-deploy insert omits the field → every nightly auto-deployed item is born `'manual'`.
  2. `BrandItemActivation` (the store-side "turn this brand item on" toggle) omits it → same, even though it stamps the vendor item numbers in the same write.
  3. `DeployToLocationDialog` still copies a template's NULL through verbatim, with no mapping fallback.

## 4. Do the mislabeled rows cause real harm?

Yes, one concrete behavioral break plus cosmetic noise.

- **`inventory-availability-sweep` filters `vendor_source IN ('pfg','produce_alliance')`.** Palm Springs' 149 `manual` + 18 NULL rows and Hemet's 41 `manual` rows are **excluded from availability / discontinued / "not seen on bid list" tracking altogether.** These items can vanish from the vendor's list and nothing will ever flag them.
- **`BrandPackConfigApprovals`** adds a `(template, vendor)` pair from any non-pfg/pa `vendor_source`, so `'manual'` rows create a bogus `manual` vendor pair in the approvals grid.
- **Not affected:** price chase / `vendor-price-chase` never filters on it (hence 148 of 149 are correctly priced), `vendor-gap-scan` uses `vendor_gap_alerts.vendor_source` — a different table — and COGS/reporting only selects the column without branching on it.
- **House-made risk:** the auto-activate-as-house-made rule fires only when `!item.vendor_source` **and** the item has no PFG/PA number at all. `'manual'` is truthy, so none of the 149 qualify. Of the 18 NULL rows, 17 carry item numbers and are skipped; **exactly 1 NULL Palm Springs row with no vendor number is exposed** to being treated as house-made.

## 5. Correct source of truth for a later backfill

Most reliable derivation, in order:
1. `brand_vendor_mappings` on the row's `brand_item_id` — the authoritative brand-level vendor link, which is what deploy already uses.
2. Failing that, `item_number` present and matching a `pfg_bid_items` row for **that location** → `pfg`; `pa_item_id` present (or matching `pa_catalog_items`) → `produce_alliance`.
3. Invoice lines as last resort (tells you who shipped it, not who it's ordered from).
4. Leave `NULL`/house-made only when there is no vendor identifier and no mapping.

Ambiguity to expect: items mapped to both vendors. Palm Springs has 4 rows and Rowlett 5 rows labeled `produce_alliance` that also carry a PFG `item_number`; Hemet 4, Palm Desert 1. A dual-source item needs a stated primary (the existing pack-config code already treats PFG as primary when both mappings exist) rather than a guess. `invoice:<vendor>` and `recipe:<id>` values are also legitimate and must not be overwritten.

## 6. Blast radius (active items, contradicting labels)

| Location | manual/NULL but has PFG number | …of those, number matches that store's bid guide | genuinely no vendor id | mislabeled the other way |
|---|---|---|---|---|
| Palm Springs | 162 | 142 | 5 | 0 |
| Hemet | 36 | 34 | 5 | 0 |
| Palm Desert | 0 | 0 | 5 | 0 |
| Rowlett | 0 | 0 | 5 | 0 |
| South Meadows | 0 | 0 | 1 | 0 |
| Tuscaloosa | 0 | 0 | 5 | 0 |
| Sandbox / Retired Clone | 0 | 0 | 9 | 0 |

No row anywhere is labeled `pfg` without a PFG number, or `produce_alliance` without a PA id. The problem is one-directional and confined to Palm Springs and Hemet — the two stores set up before the brand catalog existed.

## Recommended order of work (not executed)

1. Close the three writing paths (sweep auto-deploy, `BrandItemActivation`, `DeployToLocationDialog` mapping fallback) so new items can't be born `'manual'`.
2. Decide whether to drop the `DEFAULT 'manual'` on the column so an omission becomes NULL/visible instead of silently wrong.
3. Only then backfill the 198 contradicting rows from `brand_vendor_mappings`, with the 9 dual-vendor rows reviewed by hand.

# Pack config valuation — code-traced answer (read-only investigation)

No code was changed. Everything below comes from the files named and from live queries.

## 1. How the config is actually chosen for a location's item

There are **two** valuation paths, and only one of them reads `location_pack_selections`.

**Path A — the normal single-value path (used for the vast majority of items):**

```text
InventoryCountSession.tsx
  L454  query locations.lens_enabled            <- per-location ON/OFF gate
  L494  query brand_pack_configs WHERE status='approved'   <- NO location filter
        -> Map keyed by brand_template_id
  L873  getShape(item) -> lens = packLensMap.get(item.brand_item_id)
  -> resolveItemPackShape()          src/utils/resolveItemPackShape.ts
  -> getEffectivePackQty()           src/utils/getEffectivePackQty.ts
  -> calculateCountItemValue()       src/utils/countItemValue.ts (mirrored in ai-assistant)
```

On this path the config is **brand-wide, not per-location**. `location_pack_selections` is
never queried. Worse, the query has no `ORDER BY` and the results are collapsed into a
`Map`, so when a brand item has **more than one approved config the winner is whichever
row Postgres returned last** — undefined and can change between loads.

**Path B — the multi-config "legs" path:** `src/hooks/useLegsValuation.ts`
(`fetchLegsConfigs`, L171-220) reads `location_pack_selections` joined to
`brand_pack_configs` for that location. This is the per-location selection Jordan
designed. But it only engages when **all** of these hold: the location has
`legs_enabled = true`, the item has **2 or more** selection rows at that location, and the
count row already has **2 or more** persisted leg rows. Single-selection items — even with
a correct selection row — fall back to Path A.

**No selection row:** nothing stops valuation. Path A still attaches a brand config. So an
item with no `location_pack_selections` row is valued with an arbitrary approved config,
not with the store's own pack.

**Who creates selections:** `src/pages/BrandPackConfigApprovals.tsx` (L959-1030) writes them
at **approval** time. There is no store-side "pick my pack" write anywhere in the codebase,
and nothing derives the selection from that store's bid guide or order history.

**Snapshots override everything** on already-saved rows (`pack_quantity_at_count`,
`cost_at_count`) — submitted counts stay frozen.

## 2. How many brand items have multiple approved configs

- 276 brand templates, 231 approved config rows across **207** templates.
- **21 templates have 2+ approved configs — about 10%** of items that have any config,
  7.6% of all templates. Not "roughly half."

## 3. Selection coverage (active items that have an approved config)

| Location | items w/ config | has selection | no selection |
|---|---|---|---|
| Palm Springs | 198 | 166 | **32** |
| Palm Desert | 195 | 158 | **37** |
| Hemet | 187 | 170 | 17 |
| Rowlett | 181 | 179 | 2 |
| Tuscaloosa | 200 | 191 | 9 |
| South Meadows | 115 | 0 | 115 (lens off — unaffected) |

Lens/legs are ON at Hemet, Palm Desert, Palm Springs, Rowlett, Tuscaloosa and the retired
sandbox clone. OFF at South Meadows and Virginia St.

## 4. The five examples, re-checked

Store pack and price are identical at all three stores unless noted.

| Item | Store pack / price | Approved config(s) | Applied | 1 counted unit | Verdict |
|---|---|---|---|---|---|
| Yeast | 1/1 LB, $6.87, local pack qty 1 | one: 20/1 lb (20 lb/case, $3.7725/lb) | 20 | $0.34 per lb | **Wrong — 20x understated** |
| Granulated Sugar Bulk | 1/50LB, $40.77 | approved 1/25 lb (25); 1/50 lb archived | 25 (selected at all 3) | $1.63 per lb vs true $0.82 | **Wrong — 2x overstated on loose pounds** (full-case entries still land at $40.77) |
| Crushed Red Pepper Bulk | 1/4LB, $23.41 | two: 1/4 lb (4) and 6/4 lb (24) | Hemet selection = 1/4 lb, but PS and PD have **no selection row** → Path A picks arbitrarily | $5.85 if 4 wins (correct), $0.98 if 24 wins | **At risk / non-deterministic** |
| Tabasco Sauce | 12/5OZ, $37.47 | two: 1/5 oz (5) and 12/5 oz (60) | **no selection row at any SoCal store** (only Rowlett, Tuscaloosa) | $0.62/oz if 60 (correct), $7.49/oz if 5 | **At risk / non-deterministic, up to 12x overstated** |
| New Pesto | 8/4LB, $120.47 | two: 8/4 lb (32) and 4/4.7 lb (18.8) | selection = 8/4 lb at all 3, but the Sep 1 Palm Springs rows were snapshotted with pack 4 / inner 4.7 | $3.77/lb correct; $6.21/lb as actually snapshotted | **Wrong at Palm Springs on the Sep 1 count — ~65% overstated** |

## 5. Yeast specifically

Yes, it is genuinely wrong now — but it was not always wrong. Historical snapshots carry
`cost_at_count = 75.45` with `pack_quantity_at_count = 20`, i.e. a 20-lb case at $75.45 —
internally consistent, $3.77/lb. The stores later moved to the 1-lb bag (item 1061713,
$6.87) and `cost_per_unit` dropped to 6.87, while the only approved config stayed 20 lb per
case. Nothing in the selection or valuation logic rescues that: the lens forces pack qty 20
against a price that is now for a single pound, so a counted pound values at $0.34.

One unexplained data point: the Sep 1 Palm Desert yeast row has `pack_quantity_at_count`
NULL with cost 6.87 and 48 units — valued correctly at $329.76 — while the Palm Springs row
the same day has pack 20. I cannot determine from the data why the Palm Desert snapshot is
null; it needs a live check on the count screen rather than a guess.

## 6. Bottom line

**Yes — there is a real valuation problem at the counting stores**, but the mechanism is not
"the brand decides the pack." It is: *the count screen's main valuation path ignores
`location_pack_selections` entirely, and where multiple configs exist it picks one
non-deterministically.*

Confirmed wrong today: **Yeast** (20x under, all lens stores), **Granulated Sugar Bulk**
(2x over on loose pounds, all lens stores), **New Pesto at Palm Springs** (~65% over on the
Sep 1 count). Confirmed at risk with no selection to protect them: **Crushed Red Pepper
Bulk** and **Tabasco Sauce** at Palm Springs and Palm Desert.

Beyond the five, a price-coherence test (no approved config whose `cost_per_common_unit` is
within 15% of `cost_per_unit / count_units_per_case`) flags roughly 25-30 active items per
store at Palm Springs and Palm Desert — e.g. Cinnamon, Garlic Cloves, Croutons, Receipt
Paper, Toilet Seat Covers, Romaine Hearts, Trash Can Liners. That list needs one more pass
before anyone acts on it; some of those are legitimately unit-mismatched rather than
mis-valued.

**Where the earlier reasoning went wrong:** taking the largest `count_units_per_case` was
not the real rule — nothing picks by size. Saying "the brand decides for every store"
overstated it, because multi-selection items with legs really are driven by the location's
own selection, and all already-submitted counts are frozen by their snapshots. But the
underlying alarm was correct: an approved brand config does override the store's own pack
on the single-value path, and `location_pack_selections` is not consulted there at all.

## Suggested next step (not executed)

Make Path A location-aware: resolve the lens from that location's `location_pack_selections`
default row, and attach **no lens** when the location has no selection (fail closed to the
store's own `pack_quantity` / `cost_per_unit`) instead of grabbing an arbitrary brand row.
Then re-review the Yeast and Granulated Sugar configs, which no longer match what the SoCal
stores buy. Say the word and I will plan that build with guardrails.

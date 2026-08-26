# Brief: South Meadows deploy left ~half of inventory with no cost

Prepared 2026-08-26. Audience: external reviewers (Claude / Grok). No secrets included.

## System context (CrooHQ, React + Supabase/Postgres + Deno edge functions)

- **Brand-centric inventory.** `brand_inventory_templates` (per brand, `location_id IS NULL`) is the source of truth. Deploying a store mirrors templates into `inventory_items` rows scoped to `location_id`.
- **Vendor identity.** Each item carries vendor SKUs: `item_number` (PFG broadline) and `pa_item_id` (Produce Alliance). Brand-level alternates live in `brand_vendor_mappings`.
- **Pricing source.** PFG cost comes from that store's **bid guide** (`pfg_bid_items`, fetched per location from PFG's API via `pfg-service` action `categories`, territory/customer scoped). Cost resolution hierarchy: blended invoice price > brand vendor mapping > brand default > raw vendor pack price.
- **Vendor Gaps** (`vendor_gap_alerts` + edge function `supabase/functions/vendor-gap-scan/index.ts`): scans each brand's PFG bid guides and PA catalogs, and raises an alert for any vendor SKU that is **not** mapped to a brand template. Users then "promote"/link those SKUs into the Brand Catalog.

## Symptom

After deploying Brand Inventory to **South Meadows** (Reno, NV; org Nevada Foods Group; sibling store **Sparks**), most items rendered red / no price. Operator expected (a) Gaps to surface every unmapped/unpriced item at deploy time, and (b) self-healing inheritance from sibling stores to fill the rest.

## Hard data (queried 2026-08-26 UTC)

Active inventory items and cost coverage:

| Location | Active items | Cost = 0 | No vendor SKU at all |
|---|---|---|---|
| Hemet (CA, mature) | 176 | 2 | 6 |
| South Meadows (NV, new) | 214 | 112 | 16 |

Breakdown of the 112 zero-cost South Meadows items:

| Bucket | Count |
|---|---|
| Has PFG `item_number` **and** that number IS on South Meadows' bid guide | **0** |
| Has PFG `item_number` but that number is **NOT** on South Meadows' bid guide | **80** |
| PA-only item (`pa_item_id`, no PFG number) | 16 |
| No vendor SKU at all | 16 |

Bid guide size per location (`pfg_bid_items` distinct rows):

```
Palm Desert 199 | Hemet 198 | Palm Springs 197 | Tuscaloosa 181
Rowlett 180 | Sparks 121 | South Meadows 117
```

`vendor_gap_alerts` global state: pfg 158 resolved / 50 promoted / 17 new / 6 ignored; produce_alliance 97 resolved / 6 promoted / 7 new / 2 ignored; invoice 10 new / 2 ignored.

Brand scan timestamps (`brands.last_vendor_gap_scan_at`): Blaze Pizza last scanned 2026-08-25 10:16 UTC (nightly cadence).

## Findings (verified in code)

1. **Deploy does not trigger a Gaps scan.** `supabase/functions/deploy-location-inventory/index.ts` invokes `pfg-service` sync and `produce-alliance-service` sync, then re-runs itself to link recipe ingredients. It never invokes `vendor-gap-scan`. The scan is nightly + manual only. So an evening deploy surfaces nothing new until ~03:00 PT.
2. **Gaps alerts are brand-wide, keyed `(brand_id, vendor_source, item_number)`.** In `vendor-gap-scan`, a SKU is skipped if it already exists as a template `item_number` / `pa_item_id` or in `brand_vendor_mappings`, and an existing alert row is only merged (adds `reported_by_locations`) — status is never reopened. Consequence: a SKU already `resolved`/`promoted` for a California store never re-surfaces for a Reno store, even if the Reno store has no usable price for it.
3. **Identity inheritance works; pricing inheritance is deliberately blocked.** Deploy copies template identity (names, SKUs, pack config) but explicitly does **not** copy sibling-store costs, because PFG pricing is customer/contract specific. That is why 80 items arrive with a valid national `item_number` and $0.00.
4. **The real bottleneck is bid guide coverage.** All 0 of the zero-cost items are on South Meadows' own guide — i.e. every SKU that *is* on Reno's guide got priced correctly (the fallback works). Reno's guide is simply ~40% smaller (117 vs 198 SKUs). Reno either carries different local SKUs for those products or does not stock them under a bid contract at all.

## Open questions for reviewers

1. Should `vendor-gap-scan` become **location-aware** — i.e. raise/reopen an alert when a store has an active item with no resolvable cost, regardless of brand-wide alert status? Concern: alert fatigue (the existing design intentionally dedupes brand-wide).
2. Should deploy fire a location-scoped Gaps scan synchronously at the end (latency vs. immediacy)?
3. Is a clearly-flagged "sibling estimate" cost (nearest sibling store's price, marked `is_estimated`, auto-replaced by the first real invoice/bid price) acceptable for new stores, or does it violate data-integrity rules that forbid overwriting source-tracked values?
4. For the 80 items with a national `item_number` absent from Reno's guide: is the right fix a per-territory alternate-SKU layer (extend `brand_vendor_mappings` with a territory/customer dimension), or a PFG-side ask to add the items to the store's bid guide?

## Relevant files

- `supabase/functions/vendor-gap-scan/index.ts`
- `supabase/functions/deploy-location-inventory/index.ts`
- `supabase/functions/pfg-service/index.ts` (action `categories` = bid guide)
- `src/components/brand/LocationActivationList.tsx` (deploy trigger UI, 3-step deploy → sync → relink)
- Tables: `inventory_items`, `brand_inventory_templates`, `brand_vendor_mappings`, `pfg_bid_items`, `vendor_gap_alerts`, `location_integrations`

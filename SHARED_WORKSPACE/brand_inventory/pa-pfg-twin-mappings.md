# PA/PFG Twin Mappings — 99 Duplicate Vendor Mappings

**Filed:** 2026-06-08  
**Source:** pack-config-seeder Checkpoint A'' dry-run  
**Severity:** Medium — blocks PA data from flowing into the seeder

## The Pattern

Every `brand_inventory_template` that has a `pa` vendor mapping in
`brand_vendor_mappings` ALSO has a `pfg` mapping for the same template. Result:
- `multi-mapping hard skip` rule fires
- 0 PA catalog / PA orders rows resolve in the seeder (vs 99 PA mappings on paper)
- Dry-run buckets: `pairs_resolved_pa_catalog=0`, `pairs_resolved_pa_order=0`

## Investigation Needed

For each twinned template (e.g. "Romaine Hearts", "Grape Tomatoes", "Red Onions",
"Pineapple Tidbits (Produce Alliance)") decide:

**Option A — PFG mapping is real, PA was defensive:** drop the PA mappings.
The store actually orders produce through PFG.

**Option B — PA mapping is real, PFG was defensive/legacy:** drop the PFG mappings.
PFG produce was a transitional period; produce now flows through Produce Alliance.

Either direction → ~99 mappings to remove. Once dedup'd, PA produce data starts
actually flowing into the seeder and `pairs_resolved_pa_*` becomes non-zero.

## Sample Twinned Templates

- Romaine Hearts (Akers Mill et al.)
- Grape Tomatoes
- Green Bell Peppers (6 PA + ? PFG mappings)
- Red Onions (9 PA mappings on its own — also has PFG)
- Pineapple Tidbits (Produce Alliance)
- Romaine Lettuce (Bag)

See `needs_deduplication` payload from Checkpoint A'' (`/tmp/seeder-dryrun.json`).

## Next Steps

1. Pull current count: `SELECT brand_template_id, array_agg(vendor) FROM brand_vendor_mappings GROUP BY brand_template_id HAVING COUNT(DISTINCT vendor) > 1`.
2. Cross-reference with which vendor actually invoiced the item in the last 90d
   (vendor_invoice_items.matched_template_id + vendor_invoices.vendor_name).
   Whoever invoiced wins.
3. Drop the loser. Re-run seeder.

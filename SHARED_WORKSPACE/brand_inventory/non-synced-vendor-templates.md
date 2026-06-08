# Non-Synced Vendor Templates — Heimark Beer & Stale PFG SKUs

**Filed:** 2026-06-08  
**Source:** pack-config-seeder Checkpoint A'' dry-run, `no_invoice_history=true` rows  
**Severity:** Low — manual pack-config approval is a viable interim

## The Pattern

14 templates at the 3 production PFG stores (Hemet, Palm Springs, Palm Desert)
have mappings but zero invoice history. Breakdown:

### Heimark (beer/wine distributor — we don't sync)

11 of 14 rows:

| Template | Stores |
|---|---|
| Budweiser 12oz Cans | PS, PD |
| Estrella Jalisco 12oz | PS, PD |
| Firestone 805 Blonde Ale Cans | PS, PD |
| Michelob Ultra 12oz Cans | PS, PD |
| Porch Pounder Chardonnay Cans | PS |
| Stella Artois 11.2oz Cans | PS, PD |

Heimark is a CA beer/wine distributor. We have vendor mappings (sku 10130,
13636, 70935, 11408, 59789, 37745) but no Heimark sync, no invoice parsing
yet. **Options:**
1. Build a Heimark sync (rep portal → orders). Expensive.
2. Start uploading Heimark invoices and let vendor_invoice_items parser fill
   the gap. Requires `vendor_invoice_items.pack_size` column (see
   `pack-config-seeder` follow-up ticket).
3. Hand-author the pack configs — beer cans are uniform: 24 × 12oz CAN = 288 oz.
   ~6 unique configs cover the whole list.

### Stale PFG SKUs (3 rows)

| Template | Store | SKU | Likely cause |
|---|---|---|---|
| Dessert Bags | PD | 330237 | Discontinued / re-SKU'd |
| Meatball Bucket | PS | 851425 | Discontinued / re-SKU'd |
| Pellegrino Glass Bottle 500ml | Hemet | 936710 | Discontinued / re-SKU'd |

These SKUs have a mapping but no bid/order activity in last 30/90d. Could be:
- Genuinely discontinued at PFG → need new SKU mapping
- Out-of-stock for the window → will resolve next sync
- Mapping points to wrong SKU

Action: spot-check via PFG portal, repoint mapping or remove if discontinued.

## Recommendation

Short term: hand-approve pack configs for the 6 unique beer/wine items (covers
11 rows). File a separate ticket to investigate the 3 stale PFG SKUs.

Long term: Heimark either gets a sync built or its invoices start flowing
through `parse-vendor-invoice`.

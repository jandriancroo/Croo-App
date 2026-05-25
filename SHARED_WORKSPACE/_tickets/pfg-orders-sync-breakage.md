<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# PFG Orders Sync Breakage

**STATUS: OPEN — HIGH PRIORITY**

## Summary

`pfg_orders` line-item sync is broken or degraded for **3 of 5 real stores**:

| Store        | Symptom                                              |
|--------------|------------------------------------------------------|
| Tuscaloosa   | **100% empty `items` arrays** on every order         |
| Palm Desert  | Sync dark since **~April 17, 2026**                  |
| Rowlett      | **~25% empty shells** (order header present, items missing) |

Hemet and Palm Springs appear healthy.

## Why it matters

Order history is the load-bearing input for:

- Vendor gap detection (`vendor_gap_alerts`)
- Invoice reconciliation
- AvT theoretical-vs-actual variance
- Vendor SKU health (`vendor-sku-health-sync`)
- Pack-config seeder traceable-source classification (see `.lovable/pack-config-seeder-spec.md`)

With 3 of 5 stores partially or fully dark, order history becomes a **reliable positive signal but unreliable negative signal**:

- "This SKU appears in an order" → still trustworthy.
- "This SKU never appears in any order" → meaningless for the 3 affected stores. We cannot conclude "discontinued" or "never bought" from absence.

This silently undermines the whole vendor-data-trust premise.

## Investigation surfaces

- `.github/scripts/pfg-headless-login.mjs` and `.github/workflows/pfg-token-refresh.yml` — token health
- `supabase/functions/*` PFG-related sync functions
- `pfg_orders` table: compare `order_date`, `items` jsonb length per location over last 60 days
- Memory: `mem://integrations/pfg-sync-standards`

## Suggested first read

```sql
SELECT
  location_id,
  date_trunc('week', order_date) AS wk,
  COUNT(*)                        AS orders,
  COUNT(*) FILTER (WHERE jsonb_array_length(items) = 0) AS empty_shells,
  AVG(jsonb_array_length(items))  AS avg_lines
FROM pfg_orders
WHERE order_date >= now() - interval '90 days'
GROUP BY 1,2
ORDER BY 1,2;
```

## History

- [2026-05-25 · Lovable] Logged during Cold Cup Lids cleanup — discovered while sanity-checking why vendor-gap signals diverged across stores.

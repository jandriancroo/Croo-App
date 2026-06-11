<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# PFG Orders Sync Breakage

**STATUS: DONE — 2026-06-11**

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

## Empty-shell classification rule (canonical)

An order row with empty/NULL `items` is **not automatically broken**. Split it:

- **broken** — `items` empty AND `raw_data ? 'DeliveryKey'` (header has a native key; detail fetch should have worked → real failure, eligible for `pfg-items-backfill`).
- **pending_delivery** — `items` empty AND NOT (`raw_data ? 'DeliveryKey'`) (submitted order, delivery hasn't materialized yet → expected).

## Canonical health query

```sql
SELECT
  l.name AS location,
  date_trunc('week', po.order_date) AS wk,
  COUNT(*)                                                                                AS orders,
  COUNT(*) FILTER (WHERE (po.items IS NULL OR jsonb_array_length(po.items) = 0)
                     AND  po.raw_data ? 'DeliveryKey')                                    AS broken,
  COUNT(*) FILTER (WHERE (po.items IS NULL OR jsonb_array_length(po.items) = 0)
                     AND NOT (po.raw_data ? 'DeliveryKey'))                               AS pending_delivery,
  AVG(jsonb_array_length(po.items)) FILTER (WHERE jsonb_array_length(po.items) > 0)       AS avg_lines
FROM pfg_orders po
LEFT JOIN locations l ON l.id = po.location_id
WHERE po.order_date >= now() - interval '90 days'
GROUP BY 1,2 ORDER BY 1,2;
```

## History

- [2026-06-11 · Lovable] **RESOLVED.** Root cause: `fetchDeliveryDetail` was reconstructing the `DeliveryKey` (`opCo_cust_YYYY-MM-DD_orderKey`) instead of using the native key from the header. Hickory/OpCo 770 uses a 3-part `YYYYMMDD` format — reconstruction produced invalid keys, PFG returned empty bodies, items[] stayed empty. Auth was confirmed healthy (99.82% refresh success during the dark window). Fix: trust `order.DeliveryKey` verbatim, fall back to reconstruction only when header has no key (logged). Added `pfg_orders.source_delivery_key TEXT` column + partial index. Built `pfg-items-backfill` edge function — repaired all 7 Tuscaloosa empty shells (sample: 42-line Blaze order with real Coca-Cola syrup, dough, cheese, etc.). Rowlett/Palm Springs empties are pending_delivery (no native key) — reclassified via the rule above, not flagged as failures. Detail-fetch failures now write to `pfg_refresh_audit` (`handler='fetchDeliveryDetail'`, `outcome='detail_fetch_failed'`).
- Follow-ups deferred: `pfg-health-monitor.md` (amber UI + nightly cron), `pfg-detail-fetch-test.md` (DeliveryKey passthrough fixture).
- [2026-05-25 · Author: Claude (via Jordan)] DIAGNOSTIC CLUE from reading pfg-service code: there's a `maybeCreateChainBrokenTicket()` function that auto-files a `support_tickets` row (marker `[pfg-chain-broken:<location_id>]`) when a location's PFG token refresh chain fully breaks (standard refresh AND ROPC password fallback both fail). FIRST diagnostic step: query `support_tickets` for an open chain-broken marker on Palm Desert — its 5-week-dark period is likely a broken auth token the system already self-reported, possibly fixable by reconnecting in Settings → Integrations rather than a code change. IMPORTANT: Palm Desert (dark/auth) and Tuscaloosa (sync runs but `items[]` empty) are probably DIFFERENT root causes — don't assume one fix covers both. Tuscaloosa/Rowlett empty-shell pattern is line-item population, not auth.
- [2026-05-25 · Lovable] Logged during Cold Cup Lids cleanup — discovered while sanity-checking why vendor-gap signals diverged across stores.

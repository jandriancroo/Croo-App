<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# PFG Health Monitor — Amber UI + Nightly Cron

**STATUS: OPEN — MEDIUM PRIORITY**

## Summary

Deferred from the 2026-06-11 PFG sync-breakage resolution. We now have the canonical broken-vs-pending split (see `pfg-orders-sync-breakage.md` and `mem://features/inventory/pfg-empty-shells-rule.md`) and detail-fetch failures write to `pfg_refresh_audit`. What's missing:

1. **Nightly cron** — run the canonical health query per location, count `broken` rows from the last 7 days, persist a per-location health snapshot (table TBD or reuse `vendor_sku_health` pattern).
2. **Amber UI state** — when a location has any `broken` rows OR fresh `pfg_refresh_audit` rows with `handler='fetchDeliveryDetail'` in the last 24h, surface an amber pill on the PFG section of the Integrations / Inventory health view. Distinct from the red `[pfg-chain-broken]` support-ticket state — that's auth, this is line-item population.
3. **Auto-trigger** — when broken count > 0, optionally enqueue `pfg-items-backfill` (`apply: true`, scoped to that location, daysBack: 30).

## Why deferred

Step 5 of Session 2 explicitly excluded UI/cron — "no new UI, no monitoring cron, just queryable audit rows." The audit rows now exist (queryable today); this ticket adds the visibility layer on top of them.

## Suggested queries

```sql
-- Broken rows by location, last 7d
SELECT l.name, COUNT(*) AS broken
FROM pfg_orders po
JOIN locations l ON l.id = po.location_id
WHERE po.order_date >= now() - interval '7 days'
  AND (po.items IS NULL OR jsonb_array_length(po.items) = 0)
  AND po.raw_data ? 'DeliveryKey'
GROUP BY 1 HAVING COUNT(*) > 0;

-- Recent detail-fetch failures
SELECT location_id, caller_action, b2c_error_code, COUNT(*), MAX(created_at)
FROM pfg_refresh_audit
WHERE handler='fetchDeliveryDetail' AND created_at >= now() - interval '24 hours'
GROUP BY 1,2,3 ORDER BY 4 DESC;
```

## History

- [2026-06-11 · Lovable] Filed as follow-up after Session 2 close. Foundations (audit rows, classification rule, backfill function) are in place — this ticket adds the monitoring/visibility surface.

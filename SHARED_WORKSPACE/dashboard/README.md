<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# Dashboard

Notes about org + location dashboards: pacing, projections, cubes, favorites bar.

## [2026-09-07 · Author: Lovable] STATUS: DONE — labor recompute repo/live reconciled

`mark_labor_cache_stale_and_backfill()` (applied live 2026-09-06) is now committed
as a migration matching the live `pg_get_functiondef` byte-for-byte:
`SECURITY DEFINER`, `public.cron_edge_headers()` (no hardcoded JWT), marks
`labor_cache` stale for `source = 'punch_clock'` across OLD+NEW punch dates, posts
a `forceRefresh` backfill to `labor-service`. Trigger-only execute (revoked from
public/anon/authenticated).

- Punch edits recompute labor instantly.
- Nightly refresh-stale remains the safety net.
- labor-service still excludes today from backfill by design — unchanged.

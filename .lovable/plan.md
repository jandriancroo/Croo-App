## Goal

Stand up Clover sales sync for Playa Bowls locations as a true parallel to the QU/Blaze pipeline — same shape, separate vendor, **zero risk to QU/Blaze**.

## Core principles

1. **Brand scoping is hard-enforced.** QU code paths only run for Blaze brand (`5f805404-...`). Clover code paths only run for Playa Bowls brand (`5fb4ef79-...`). No Playa location ever hits QU, no Blaze location ever hits Clover.
2. **`sales_cache` stays untouched** (locked-feature rule #5). Clover gets its own twin table `clover_sales_cache` with the same columns and write semantics.
3. **`labor_cache` source pattern is preserved.** When we later add Clover labor, it writes with `source = 'clover'`.
4. **Same UI, same dashboards.** A thin routing helper picks the right cache table by brand so `Dashboard`, `SalesSummary`, `Org Dashboard`, projections, etc. don't need to know which POS produced the data.

## What gets built

### 1. Database (migration)

- `clover_sales_cache` — column-for-column twin of `sales_cache`:
  `location_id, sale_date, net_sales, guest_count, avg_ticket, hourly_data, projected_sales, validation_status, validation_attempts, flagged_no_sales, yoy_sale_date, yoy_net_sales, yoy_hourly_data, payments_data, living_projection, override_projection, override_at, override_by, initial_projection, product_mix, fetched_at, created_at`
  (`pizza_count` dropped — not relevant; Playa equivalent can live in `product_mix`.)
- Unique index on `(location_id, sale_date)`.
- RLS + GRANTs identical to `sales_cache`.
- Add `'clover'` as a valid value to `labor_cache.source` check (no schema change needed if it's a free TEXT).

### 2. Edge function `clover-sync`

Mirrors `fetch-qubeyond-sales` structurally but for Clover REST API:

- Reads credentials from `location_integrations` where `integration_type='clover'` (already saved).
- **Brand guard at top:** resolves `location_id → organization.brand_id`, exits early unless brand = Playa Bowls.
- Pulls per business day (PST, 10 AM cutoff — same Luxon rules as QU):
  - `/v3/merchants/{mid}/orders` (paid, in window) → net sales, guest count, hourly buckets, line items → `product_mix`
  - `/v3/merchants/{mid}/payments` → `payments_data` (cash/card/3PD split, tips)
- Writes with **conditional spread merge** (`...existing, ...new`) to protect `projected_sales`, `payments_data`, `product_mix` — same rule as QU.
- `isWithinBusinessHours` logic copied verbatim from sales-cache sync (post-midnight handling, 3 AM yesterday resync).
- Actions: `sync_today`, `sync_yesterday`, `sync_range`, `backfill_53w` (mirrors QU surface).

### 3. Cron schedule

Two pg_cron jobs (Playa-only — function self-guards by brand):
- Every 15 min during business hours → `sync_today` for all active Playa locations with Clover creds.
- Daily 3 AM PST → `sync_yesterday` + maintenance.

### 4. Read-side routing

New helper `getSalesCacheTable(brandId)` returns `'sales_cache' | 'clover_sales_cache'`. Used by:
- `src/utils/salesCache.ts`
- `src/hooks/useReportData.ts`, `useOrgDashboardData.ts`, `usePrefetchDashboard.tsx`
- `Dashboard.tsx`, `BrandDashboard.tsx`, `SalesSummary.tsx`, `CompactDashboard.tsx`
- `sales-service` edge function (`?brand=` aware)

For Org/Brand dashboards spanning both brands, queries union the two tables. The `setQueryData` "Master Writer" pattern stays intact.

### 5. Backfill (post-validation)

Once the first Playa location's `sync_today` looks right, run `backfill_53w` via the maintenance queue (same pattern as Sales Backfill System memory) to populate YOY pacing.

## What is NOT in this pass

- Clover labor sync (separate follow-up; will write to `labor_cache` with `source='clover'`).
- Clover webhooks / streaming (polling-only v1, like QU started).
- Product-mix → inventory depletion mapping (uses existing `product_mix` pipeline once data lands).

## Files touched

```text
NEW  supabase/functions/clover-sync/index.ts
NEW  migration: clover_sales_cache + RLS + grants
EDIT supabase/functions/sales-service/index.ts        (brand-aware table selection)
EDIT src/utils/salesCache.ts                          (table router)
EDIT src/lib/queryKeys.ts                             (clover keys)
EDIT dashboards + hooks listed above                  (route by brand)
NEW  cron entries via insert tool (URL + anon key)
```

## Validation gates before going wide

1. Migration applied, `clover_sales_cache` reachable via Data API.
2. Manual `sync_today` for Wilco TX returns rows with correct net sales matching Clover dashboard.
3. Dashboard for the Wilco TX location renders sales identically to a Blaze location.
4. Confirm a Blaze location dashboard is unchanged (regression check).
5. Then enable cron + backfill.

Confirm and I'll start with the migration.
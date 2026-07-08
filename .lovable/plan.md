
# Aloha POS Integration (Buffalo Wild Wings GO)

You have a portal login (sierrafoodgroup.alohaenterprise.com) but no confirmed API/export path yet. Rather than guess, I'll build the **entire plumbing** now — table, edge functions, cron, UI hook — matching the QU/Clover pattern exactly. A single `fetchAlohaDay()` function is the only stub; the moment we learn *how* to pull (NCR Aloha Cloud API, headless portal scrape like PFG, or Aloha Insight SFTP), we swap that one function and everything downstream (sales_cache, projections, dashboards, YOY, labor) lights up automatically.

## What gets built

### 1. Database (one migration)

**`public.aloha_sales_cache`** — raw archive table, twin of `clover_sales_cache`:
- Same columns: `location_id`, `sale_date`, `net_sales`, `guest_count`, `avg_ticket`, `hourly_data`, `product_mix`, `payments_data`, `yoy_*`, `projected_sales`, `living_projection`, etc.
- Unique on `(location_id, sale_date)`
- RLS mirroring `clover_sales_cache` (location membership scope)
- GRANTs for authenticated + service_role

No changes needed to `sales_cache` — `pos_source` is already TEXT; we just start writing `'aloha'`.
No changes needed to `labor_cache` — `source` is already TEXT; we write `'aloha'` alongside `'punch_clock'`.

### 2. Edge functions

**`supabase/functions/aloha-service/index.ts`** — creds save/test (mirrors `clover-service`)
- `action: 'test'` — validates credentials against Aloha (stub returns `not_implemented` with clear next-steps message)
- `action: 'save'` — upserts into `location_integrations` with `integration_type='aloha'`

**`supabase/functions/aloha-sync/index.ts`** — the sync engine (mirrors `clover-sync`)
- Brand guard: refuses any location not on BWW GO brand
- All the actions QU/Clover support: `sync_today`, `sync_yesterday`, `sync_date`, `sync_range`, `sync_dates`, `sync_all_today`, `sync_all_yesterday`
- Shared projection module (`_shared/projections.ts`) — same pace/YOY math as QU + Clover
- Dual-write pattern: raw → `aloha_sales_cache`, normalized → `sales_cache` with `pos_source='aloha'`
- Conditional spread on `projected`, `labor`, `payments_data` (preserves sibling fields — see core rule)
- Labor: writes to `labor_cache` with `source='aloha'` when the day contains labor
- **One clearly-marked TODO**: `fetchAlohaDay(creds, date)` returns hourly sales + product mix + labor. This is the *only* place Aloha-specific transport code lives.

**`supabase/functions/backfill-aloha-sales/index.ts`** — 53-week backfill (mirrors `backfill_clover_sales`)
- Queues one location, walks 371 days back in batches of 7
- Seeds YOY (−364d) inside `syncOneDay`
- Registered as a maintenance queue task the same way Clover backfill is

### 3. Cron

Adds Aloha to the existing 3 AM PST `sync_all_yesterday` cron alongside QU + Clover (single line in the cron SQL).

### 4. UI

**`src/components/location/AlohaIntegrationCard.tsx`** — creds form on the location integrations tab
- Portal URL, username, password fields (adjusted once we confirm the actual data path — API key vs portal login)
- Test / Save / Backfill buttons
- Status badge

**`docs/brands/bww-go.md`** — updates the BWW GO brand doc: POS = Aloha, links the sync/backfill functions, marks integration Pilot status.

### 5. What's *not* being built yet (blocked on info)

The `fetchAlohaDay()` stub. Once you can answer one of:
- Does Sierra Food Group have Aloha Cloud API credentials? (best path, real REST API)
- Can you get an Aloha Insight scheduled CSV export enabled? (SFTP drop we poll)
- Do we need to headless-login to the portal and scrape reports? (works today, brittle — same pattern as our PFG scraper)

…I plug it into that one function and the rest works with zero further changes.

## Locked rules honored

- `sales_cache` conditional-spread merge (protects `projected`, `labor`, `payments_data`)
- `labor_cache` writes include `source='aloha'` + respect unique `(location_id, labor_date, source)`
- Never merges labor back into `sales_cache`
- All dates handled with Luxon in store-local timezone; string-first `yyyy-MM-dd`
- Brand guard on every sync call (no cross-brand leaks)
- GRANTs on the new table
- Follows `docs/adding-a-new-pos.md` 5-step checklist exactly

## Deliverables

1. Migration: `aloha_sales_cache` table
2. Edge functions: `aloha-service`, `aloha-sync`, `backfill-aloha-sales`
3. Cron entry for nightly `sync_all_yesterday`
4. `AlohaIntegrationCard.tsx` UI component
5. Updated `docs/brands/bww-go.md`
6. A short "what we need from Sierra Food Group" note in the doc so you can ask them the right question

Approve and I'll ship it. After that, one follow-up turn will wire `fetchAlohaDay()` once we know the data source.

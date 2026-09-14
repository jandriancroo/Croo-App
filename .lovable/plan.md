# Vendor sync cleanup — Stage 1

## Part 1: the four old jobs are already gone

I checked the live schedule before planning anything. Those four jobs are **not running** — they were already retired on Sep 2 by a guarded cleanup migration (`20260902045350_...sql`, which unschedules exactly those four names and is safe to re-run).

The only vendor-related jobs on the schedule today:

| Job | Schedule | Keep? |
|---|---|---|
| `vendor-sync-nightly` | 10:20 UTC daily | Yes — the new pipeline |
| `pfg-keep-alive-every-5m` | every 5 min | Yes — token upkeep only |

Nothing named `nightly-vendor-gap-scan`, `vendor-gap-scan-nightly`, `pfg-scheduled-price-sync-every-8h`, or `nightly-pack-config-seeder` exists in the schedule.

So there is **no migration to write for Part 1**. If prices are still moving in a way that looks like the old 8-hour job, the cause is elsewhere and we should trace it separately rather than unschedule something that isn't there.

### Where those underlying functions stand

- `vendor-gap-scan` — still needed. The nightly pipeline calls it as its gap stage.
- `pack-config-seeder` — still needed. The nightly pipeline calls it as its pack-config stage.
- `pfg-scheduled-price-sync` — no caller anywhere: no schedule entry, no other function, no app code. It is dead code and the one real candidate for removal in a later stage. Not touching it now.

## Part 2: the second fake store

Confirmed today:

- Sandbox #7777 — excluded from billing (`Billing.tsx`, `check-subscription`) and from vendor syncs (a hardcoded id list in the shared inventory gate, which also lists a second inactive Sandbox clone).
- Lite QA — Smoke Test (`QA-LITE-01`) — **active**, no exclusion anywhere. Only "safe" because inventory happens to be switched off.

The `locations` table has no test/QA marker column today, so a shared pattern means adding one. That is small and it is the right call — recommended:

1. Add a `is_test_location` true/false column to locations, default false.
2. Mark the three known fakes: Sandbox #7777, the inactive Sandbox clone, and Lite QA — Smoke Test.
3. Switch the billing page and the subscription check from "store number is not 7777" to "not a test location".
4. Switch the vendor-sync gate from its hardcoded id list to the same flag, keeping the id list as a fallback so nothing loses protection during the swap.

Result: one place to mark a future test store, and it is immediately invisible to billing, subscriptions, and every vendor sync — with no store-number string matching anywhere.

## Technical notes

- Migration: `ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS is_test_location boolean NOT NULL DEFAULT false;` then `UPDATE` the three ids above. No grant/RLS change needed (existing locations policies cover it).
- `src/pages/Billing.tsx` — `billableLocations` filter becomes `!l.is_test_location`; add `is_test_location` to the location selects in `src/hooks/useLocation.tsx` (three queries) and to the `Location` interface.
- `supabase/functions/check-subscription/index.ts:239` — replace `.neq("store_number", "7777")` with `.eq("is_test_location", false)`.
- `supabase/functions/_shared/inventoryGate.ts` — keep `EXCLUDED_LOCATION_IDS` as a belt, and make `isInventoryEnabled` require `is_test_location = false`; `filterEnabledLocations` adds `.eq("is_test_location", false)`. That covers all eight callers of the gate (vendor-sync-nightly, vendor-gap-scan, vendor-price-chase, deploy-location-inventory, produce-alliance-service, pack-selection-backfill, pfg-service, pack-config-seeder) in one edit.
- Types regenerate after the migration, so the client edits land after it.
- No cron changes, no function deletions, nothing published.

## What I need from you

Confirm you want the shared `is_test_location` flag (my recommendation) rather than a second hardcoded `QA-LITE-01` check, and whether the inactive Sandbox clone should be flagged too (I assume yes).

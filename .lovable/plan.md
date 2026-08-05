# Fix: Promo tracker showing 0 — blocked backend sync

## What actually happened

The tracker itself is fine; the data feeding it stopped.

Confirmed from the database and backend logs:

- The Blaze/QU sales sync endpoint (`sales-service`) returns **401 Unauthorized on every single run** — zero successes in the last several hours.
- Cause: the recent security hardening added a caller guard accepting only the service-role key, the shared cron secret (`x-cron-secret`), or a verified signed-in user. Every scheduled job in the database still calls with the **public anon key**, which the guard correctly rejects. No scheduled job sends `x-cron-secret` at all.
- Result for QU stores: product mix is null on every day from **July 31 onward** (last full day: July 30), so the tracker computes 0 units / $0 / 0.0% for all 12 stores.
- The Clover sync's scheduled runs are 401ing for the same reason (Georgetown only has recent data because runs got triggered from signed-in sessions).

## PMIX is not the only thing blocked

Everything `sales-service` writes or refreshes is blocked, not just product mix:

- **Product mix / PMIX** — promo tracker, item ranking, category segments, depletion-driven usage math.
- **Payments / tender breakdown** (`payments_data`) — no new tender data on QU days.
- **Tips sync** (its `sync-tips` action) — QU tip pulls are dead.
- **Hourly sales refresh, guest count, average ticket** on the minutely path, plus the YOY snapshot fields it stamps.
- **Backfill / sync-day / sync-yesterday** — any repair or historical resync also 401s, which is why the gap never self-healed.
- **Clover 2-minute + 3 AM resync** for Georgetown, same guard.

Partial mitigation that hid the problem: QU daily net sales are still landing through the separate webhook/`fetch-qubeyond-sales` path (that one still returns 200), so headline sales looked normal while item-level and payment detail went dark.

Other cron-driven functions (alerts, shift reminders, email queue/batch, maintenance queue, aloha sync) are still accepted today, but they call with the same anon-key pattern and are one guard change away from the same failure — worth fixing in the same pass.

## Fix plan

**1. Give scheduled jobs a valid credential**

- Rotate `CRON_SECRET` to a freshly generated value, set it as the backend secret, and store the same value in the database's secure vault so scheduled SQL can read it (never inlined in the job definition).
- Add a security-definer helper that returns the cron secret for scheduled jobs.
- Rewrite every scheduled job that calls a backend endpoint to send `x-cron-secret` instead of relying on the anon key: sales sync (minutely), Clover sync (2-min + 3 AM), Aloha sync (2-min + 3 AM), labor nightly, daily briefing, vendor gap scans, produce-alliance nightly, PFG price sync, pack-config seeder, shift reminders, email queue/batch senders, alert push sender, maintenance queue processor, auto punch-out, birthday sync, daily changelog. Same job names and schedules — no duplicates.

**2. Verify**

- Trigger the sales sync manually, confirm a 200 and a fresh cache row with product mix, then confirm zero 401s in the endpoint logs.

**3. Backfill the blackout window**

- Re-run the QU sync for July 31 → today across all active locations, and the Clover resync for Georgetown, restoring product mix, payments, tips, guest count, and avg ticket.
- Uses existing idempotent cache upserts; `source` tagging and conditional merge of projected/labor/payments preserved; nothing written to sales-cache labor columns.

**4. Confirm the tracker**

- Reload the Dash promo tracker and verify units/sales/PMIX and ranking populate across the promo date range.

## Technical notes

- Guard lives in `supabase/functions/_shared/callerAuth.ts` (`requireCaller` / `requireAuthorizedCaller` / `requireInternalCaller`). Its strictness is unchanged — the anon key stays rejected; only the callers are fixed.
- Job rewrites via migration using `cron.schedule` with existing job names.
- Vault-stored secret is readable only by the helper; the raw value never appears in job definitions or logs.
- No changes to tracker components, `get_tracker_ranking`, or any locked feature (3D cubes, inventory, dock/toast, version check, support tickets).

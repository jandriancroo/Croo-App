# Fix: Promo tracker showing 0 for every store

## What actually happened

The tracker itself is fine. The data behind it stopped arriving.

Confirmed by inspecting the database and backend logs:

- The tracker reads item-level product mix out of the sales cache. The most recent day with product mix for the Blaze (QU) stores is **July 30** (Palm Desert has one stray Aug 1 row). Every store after that has empty product mix, so the tracker computes 0 units / $0 / 0.0% for everyone.
- The backend sales sync (`sales-service`, scheduled every minute) is returning **401 Unauthorized on every single run**. Same for the Clover sync.
- Cause: the recent security hardening added a caller-auth guard to these endpoints that only accepts the service-role key, the shared cron secret (`x-cron-secret` header), or a signed-in user token. But **every scheduled job still calls the endpoints with the public anon key**, which the new guard correctly rejects. No scheduled job in the database sends `x-cron-secret` at all.

So this is not a tracker bug and not a data-loss event — the nightly/minutely automation has been locked out of its own endpoints since the hardening deploy.

Only the QU/Blaze pipeline shows the full blackout; Clover (Georgetown) and Aloha (Virginia St) still have some days because those runs were partly triggered from signed-in sessions.

## Fix plan

**1. Give the scheduled jobs a valid credential**

- Rotate `CRON_SECRET` to a freshly generated value, set it as the backend secret, and store the same value inside the database's secure vault so scheduled SQL can read it (never inlined as plain text in the job definition).
- Add a small helper function that returns the cron secret from the vault for use by scheduled jobs.
- Rewrite every scheduled job that calls a backend endpoint so it sends the `x-cron-secret` header instead of relying on the anon key. Affected jobs (all currently rejected or at risk):
  sales sync (minutely), Clover sync (2-min + 3 AM), Aloha sync (2-min + 3 AM), labor nightly, daily briefing, vendor gap scans, produce-alliance nightly, PFG price sync, pack-config seeder, shift reminders, email queue/batch senders, alert push sender, maintenance queue processor, auto punch-out, birthday event sync, daily changelog.

**2. Verify the guard accepts it**

- Trigger the sales sync manually and confirm a 200 plus a fresh cache row with product mix, then re-check the endpoint logs for zero 401s.

**3. Backfill the missing days**

- Re-run the sales sync for the blackout window (July 31 through today) for all active locations so product mix and net sales are restored. Uses the existing per-day sync path and idempotent cache upserts — sales cache write rules (source tagging, conditional merge of projected/labor/payments) are preserved, and nothing is written to labor columns of the sales cache.

**4. Confirm the tracker**

- Reload the Dash promo tracker and confirm units/sales/PMIX and ranking populate for the promo's date range.

## Technical notes

- Guard lives in `supabase/functions/_shared/callerAuth.ts` (`requireCaller` / `requireAuthorizedCaller` / `requireInternalCaller`). No change to the guard's strictness — the anon key stays rejected; only the callers get fixed.
- Scheduled job rewrites are done via migration using `cron.schedule` with the same job names and schedules, so nothing new is introduced and no job is duplicated.
- The vault-stored cron secret is readable only by the security-definer helper; the raw value never appears in job definitions or logs.
- No changes to the tracker components, `get_tracker_ranking`, or any locked feature (3D cubes, inventory, dock/toast, version check, support tickets).

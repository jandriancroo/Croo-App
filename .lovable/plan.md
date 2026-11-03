# Fix false late / no-call-no-show alerts at Toast stores + robot sign-out alert

## What was confirmed before writing this
- **Late block** (current `check_alerts_sql`, from migration 0086): only checks `time_punches` for a `clock_in`. The NCNS block already also accepts `toast_shifts` (`croo_user_id`, `location_id`, `shift_date`, `in_time IS NOT NULL`).
- **Which stores clock in on a POS:** `public.labor_source_for(_location_id)` already exists and returns `'toast'` for Toast-clock stores (used by `_shared/onClock.ts`). We use that, so Aloha can join later by returning its own value.
- **Labor last-refresh timestamp:** `toast-sync` upserts `labor_cache` (`source='toast'`, one row per store per day) with `fetched_at = now()` on every labor read. Right now Hayward shows labor `fetched_at` 17:36 UTC and live sales 17:35 UTC, so it moves with each poll. Confirmed: this is the per-store labor last-refresh time.
- **Not verifiable after the fact:** `labor_cache.fetched_at` and `toast_shifts.updated_at` are overwritten on each poll, so the 8:03 AM freeze on 11/2 can't be seen in the data now. Ryan's reading matches the code, though.
- **Watchdog:** `toast-watchdog` decides "stale" only from `toast_sales_cache` live `fetched_at`. **toast-service heartbeat:** sets `alert_stage = 0` on every `polling` / `signed_in`. Both confirmed in code. So while sales keep flowing, a labor sign-out never alerts.

## 1. Migration `0088_toast_clock_alert_guards.sql`
All in one migration. `check_alerts_sql` is changed **in place** with the same text-splice method 0086 used (read `pg_get_functiondef`, replace exact snippets, `EXECUTE` the result as CREATE OR REPLACE). It is never dropped, so its revoked grants stay as they are. The migration fails (RAISE) if any snippet isn't found exactly once.

a) **New helper** `public._pos_clock_feed_fresh(_location_id uuid) returns boolean`. STABLE, SECURITY DEFINER, `search_path = public, pg_temp`, execute revoked from public/anon/authenticated:
- `labor_source_for(_location_id)` is not a POS source (anything except `'toast'` today) → `true`, so behaviour stays the same as today.
- Toast → `true` only when `max(labor_cache.fetched_at)` for that store with `source='toast'` is within the last **30 minutes**. Otherwise `false`.

b) **Late block change.** The `has_punch` check becomes:
```sql
SELECT EXISTS (SELECT 1 FROM time_punches tp WHERE <unchanged>)
    OR EXISTS (SELECT 1 FROM toast_shifts ts WHERE ts.croo_user_id = shift.user_id
               AND ts.location_id = loc.id AND ts.shift_date = local_date::DATE
               AND ts.in_time IS NOT NULL)
INTO has_punch;
```
This one check covers both the manager row and the `late_arrival_self` row. Text, dedup keys and timing windows don't change.

c) **Stale-feed guard.** At the start of the late section and the NCNS section, each store gets:
`v_feed_ok := public._pos_clock_feed_fresh(loc.id);` and the store is skipped when the result is false. Stores that use the CrooHQ clock always pass.

d) **Robot status bookkeeping:** `ALTER TABLE toast_robot_status ADD COLUMN IF NOT EXISTS labor_alert_stage int NOT NULL DEFAULT 0`. This is an additive column. Sales and labor get separate ladders so neither one resets the other.

e) **Andy's security piggyback:**
```sql
alter function public.check_weekly_checklist_alerts_sql() set search_path = public, pg_temp;
revoke execute on function public.check_weekly_checklist_alerts_sql() from public, anon, authenticated;
```

## 2. Watchdog change (`toast-watchdog/index.ts`)
- The existing sales-stale check, restart dispatch and stage 1/2 ladder on `alert_stage` stay unchanged.
- **New labor check** for each store, inside the same store-hours window: read the latest `labor_cache.fetched_at` (`source='toast'`) for the store. If it is at least 30 min old and the window is at least 30 min in:
  - when `labor_alert_stage = 0`, queue one `toast_robot_down` row to super admins through the existing `alert_queue` path. Title: "Toast labor stopped — <store>". Body: "Clock-ins haven't updated since <time>. Sales may still be flowing. Restarting the robot." Dedup key: `toast-labor:<store>:<labor fetched_at>`, so each separate sign-out alerts once. Then set `labor_alert_stage = 1`.
  - Also request a robot restart, using the same dispatch and cooldown as today.
- When labor is fresh again (under 30 min old), set `labor_alert_stage = 0`, so the next sign-out alerts again.
- The sales ladder resets only when sales are fresh, exactly as today.

## 3. Heartbeat change (`toast-service/index.ts`)
- Remove `...(good ? { alert_stage: 0 } : {})` from the heartbeat. Resets now come only from the watchdog, which checks the actual data. A `polling` heartbeat while labor reads fail will no longer clear the alert. Nothing else in the heartbeat changes (state, login cap, run id).
- The runner and Toast parsing are not touched.

## 4. Tests
**SQL (seeded in a rolled-back transaction, with no real alerts sent):** fixture stores for a Toast store and a CrooHQ-clock store, run `check_alerts_sql()`, then inspect the `alert_queue` rows inside the transaction and roll back.
- Toast store, shift started 16 min ago, Toast `in_time` present, no punch → no `late_arrival` or `late_arrival_self` row.
- Same but no `in_time` and labor fetched 2 min ago → exactly one manager row and one self row. A rerun adds none.
- Labor fetched 2 h ago → no late rows and no NCNS rows for that store.
- CrooHQ-clock store → the same rows as the current definition. Checked with a before/after comparison on the same fixture.

**Deno (watchdog, stubbed client):**
- Labor stale while sales are fresh, during hours → one `toast_robot_down` row to super admins, and `labor_alert_stage = 1`. A second run adds no new row.
- Labor fresh again → `labor_alert_stage = 0`. A later stale labor time → a new alert with a new dedup key.
- Existing sales-stale ladder tests still pass.

**Deno (toast-service):** a `polling` heartbeat no longer changes `alert_stage`.

## 5. Deploy
Apply migration 0088, then deploy `toast-watchdog` and `toast-service` only. No real Toast calls, no live alerts and nothing published.

## Rollback
- Revert `check_alerts_sql` to the 0087-era definition (saved in the migration as a comment, and re-applied in place the same way). `location_settings.ncns_alert_minutes = 0` still turns NCNS off per store.
- `grant execute on function public.check_weekly_checklist_alerts_sql() to authenticated; alter function public.check_weekly_checklist_alerts_sql() set search_path = public;`
- Revert `toast-watchdog` and `toast-service` to the previous commit. The extra `labor_alert_stage` column can be left in place unused.

## Untouched
Punch, kiosk and time-clock code; Toast parsing and the runner; the `shift_offer_claims` policy; goal code; `time_punches` and `toast_shifts` (read only).

## Open assumption
The robot writes `labor_cache` on every poll, even before anyone clocks in. Hayward's current timestamps support this. If labor rows only appear after the first clock-in, the 30-minute window offset prevents a false "labor stopped" alert right at open.

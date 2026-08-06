# Urgent: all clock-ins are failing system-wide

## Confirmed cause

Today's `mark_labor_cache_stale()` update (deployed 06:36 UTC) reads the store timezone from `locations.timezone`. That column does not exist — timezone lives in `location_settings.timezone`. The function is a trigger on `time_punches`, so every insert raises a runtime error and the punch is rejected. The kiosk surfaces that as "Failed to clock in".

Evidence:
- `locations` has no timezone column (verified against the schema).
- Zero rows written to `time_punches` at any location since 06:27 UTC (last night's closing punches). Nothing today anywhere — Palm Springs, Palm Desert, Hemet.
- PIN entry itself is fine: Palm Springs logged successful matches for Liz Hernandez (10:03 PT) and Andrea Navarro (10:03 and 10:04 PT), each followed by no punch row.

## Fix

Replace the timezone lookup inside `mark_labor_cache_stale()` with `location_settings.timezone`, falling back to `America/Los_Angeles` when unset. Everything else about the function stays as it is (same staleness updates, same DELETE/UPDATE handling, same `source = 'punch_clock'` scope).

Also make the lookup non-fatal: wrap it so that if the timezone lookup ever fails, the trigger still returns the row rather than blocking the punch. Marking labor cache stale is a bookkeeping side effect and must never be able to stop a clock-in.

## After the fix

1. Confirm a punch insert succeeds (verify a fresh row lands in `time_punches`).
2. Tell Palm Springs to re-enter PINs — nothing was saved, so Liz and Andrea need to clock in again, and their actual start times will need a manager time-card edit back to ~10:03 AM.
3. Check Palm Desert and Hemet for anyone who tried this morning and was blocked, so their day can be corrected too.

## Out of scope

No punch clock UI, feature, or access changes. The break-violation / labor-rules review is unrelated and paused until this is resolved.

## Technical detail

Single migration replacing `public.mark_labor_cache_stale()`:
- `SELECT timezone INTO tz FROM public.location_settings WHERE location_id = COALESCE(NEW.location_id, OLD.location_id)`
- `tz := COALESCE(tz, 'America/Los_Angeles')`
- Guard the body so an unexpected error returns `COALESCE(NEW, OLD)` instead of aborting the write.

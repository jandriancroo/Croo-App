# Duplicate manager punches on one shift — findings and fix plan

## What happened (plain version)
Each manager's Time Tracking screen showed an old copy of the shift. The save worked and refreshed the screen of the manager who saved, but nobody else's screen refreshed. The other manager (and the employee's kiosk clock-out) were invisible to each manager's copy, so a second clock-out and break pair got added. Nothing in the database said "this shift already has a clock-out."

## 1. Exact pieces involved and why it went stale
- Screen: `src/pages/PayrollReview.tsx` opens the "Edit Shift" dialog with `editingShift.dayPunches` — a snapshot taken from the time-card list when it was loaded.
- Form: `src/components/timetracking/EditShiftForm.tsx` builds its clock-in/out/break fields only from that snapshot. If the snapshot has no clock-out, saving **inserts** a new `clock_out` (plus new `break_start`/`break_end`) instead of editing one. It never re-reads the shift before saving.
- Data: `src/hooks/usePayrollData.tsx` keeps time cards in local React state (`useState`), not a shared query. `fetchTimeCards()` runs on load, and `onSave` does call it — but only on the saving manager's screen.
  - There is a 5-minute "skip reload" guard (`lastFetchRef`, `STALE_MS`), so coming back to the page within 5 minutes also shows old data.
  - There is no live update (realtime) or reload when the window gets focus, so other people's edits and kiosk punches never show up until a manual reload.
- Also found: the form's insert/update calls ignore database errors (each `await supabase...insert(...)` result is never checked). A rejected save would still show "Shift updated." This has to be fixed before any server guard will show the right message.
- Kiosk clock-out at 6:38 PM: the manager's snapshot was loaded before the employee clocked out, so the manager added a second clock-out on top of it.

## 2. Proposed fix

### A. Screen side (small, safe)
1. In `EditShiftForm`, right before saving, re-read that person's punches for the shift's window from the database. If anything changed since the dialog opened (new clock-out, new breaks, edits by someone else), stop the save and show: "This shift changed while you were editing (someone else or the kiosk added punches). We reloaded it — please check and save again." Then reload the form with fresh data.
2. Check every insert/update/delete result; on error, stop and show a friendly message instead of "Shift updated."
3. In `usePayrollData`, reload time cards when the window regains focus or the app resumes (reuse the existing app-resume signal), skipping the 5-minute guard in those cases. Optional: listen for time_punches changes for this store and reload (debounced).
4. Same "check result" fix in `QuickPunchDialog` save path (via `src/lib/punches.ts`, which already throws errors).

### B. Database guard (the real safety net)
A plain unique index is **not** safe: today 553 shifts already have more than one clock-out and 359 have more than one clock-in (split shifts and break-return clock-ins share a shift). A unique index would fail to build and would block legitimate split shifts.

Instead, one guard trigger on `time_punches` (BEFORE INSERT), running after the existing shift-attach trigger so `shift_id` is known:
- New `clock_out`: reject if that person already has a `clock_out` on the same shift with no `clock_in` between it and the new punch (that is, the shift is already closed). Message: `DUPLICATE_CLOCK_OUT`.
- New `break_start`/`break_end`: reject if it falls inside an existing break on the same shift for that person, or exactly duplicates one within 2 minutes. Message: `DUPLICATE_BREAK`.
- Applies only to rows created by a manager (`created_by` set and different from `user_id`). Kiosk and auto punch-out inserts pass through unchanged, so the kiosk can never be blocked from clocking someone out.
- New rows only; existing rows are never checked or changed.

The UI maps those two codes to: "This shift already has a clock-out — edit that one instead" and "That break overlaps one already on this shift."

## 3. Risks
- Kiosk: guard skips kiosk/self punches, so no kiosk change. The "already closed" check can still catch a manager adding a clock-out after the kiosk one — that's the goal.
- Auto punch-out: it runs on the server and does not set a manager `created_by`, so it is skipped. Will confirm in the build step before applying.
- Existing duplicates: 553 shifts with multiple clock-outs already exist. The guard doesn't touch them; cleaning them up would be a separate, approved data job. Some may be real split shifts.
- Midnight shifts: the "closed shift" check uses order of punch times, not calendar day, so overnight shifts are fine.
- Delete-and-re-add: a manager deleting the old clock-out first, then adding a new one, still works.
- Locked features / protected caches: none touched. Labor cache triggers stay as is.

## Files I would change
- `src/components/timetracking/EditShiftForm.tsx` — re-read before save, conflict message, error checks, friendly codes.
- `src/hooks/usePayrollData.tsx` — reload on focus/resume, bypass 5-minute guard then.
- `src/components/timetracking/QuickPunchDialog` (existing file) — friendly messages for the two codes.
- New migration — guard trigger function on `time_punches` (no index, no data changes).
- `AGENTS.md` — one rule: manager-added duplicate punches blocked only by the time_punches guard trigger.
- Not touched: PunchClock/kiosk, auto punch-out, `src/lib/punches.ts` logic, pay math, bucketing.

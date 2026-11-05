# Fix: offers with no end time must last until the end of the shift's day

## What's wrong now (checked in the code)
When a shift has no end time, the feed still falls back to the old rule and hides the offer as soon as the shift **starts**. Jordan's tweak says it should stay until the end of that calendar day in the store's time zone.

Current commit: 08eafcf41.

## The change
1. **`src/hooks/useOpenShiftOffers.tsx`**: one line in `offerVisibleInFeed`.
   - When there's no end time, the offer stays until 11:59:59 PM on the shift date in store time, and hides once the next day begins.
   - In code terms, the end becomes `"<shift_date> 24:00"`, which sorts after `23:59` and before the next day's `00:00` in the existing store-time comparison. It never falls back to the start time.
   - Everything else stays as approved:
     - available and claimed offers stay visible until the shift ends; approved offers are hidden
     - shifts that end after midnight roll over to the next day
     - the "Shift started" label still replaces Claim and Assign after start
2. **`src/lib/shiftMarketplace.test.ts`**: new tests for a shift with no end time on Nov 5, starting at 2 PM:
   - 3 PM, after start: visible.
   - 11:59 PM: visible.
   - Nov 6 at 12:00 AM: hidden.
   - A claim waiting for approval with no end time, after start: visible.
   - Approved with no end time: hidden.
   - The existing tests for Michelle's 2:00–8:30 PM Chicago shift stay as they are (visible through 8:29, hidden at 8:30).

No other files. No data updates, schedule reassignments, database, punch, kiosk or native/iOS changes.

## Publishing (blocker)
The last two publishes went out because this workspace doesn't require security findings to be fixed first. The 26 critical findings are still open; they're older and unrelated to this fix. As you asked, I'll treat them as a deployment blocker: after the fix and tests pass, I will **not** publish. Jordan decides whether to publish once he has reviewed them in the Security view.

## Verify
- Run the tests and the build.
- In the preview, Georgetown's feed: Michelle's offer still shows (before 8:30 PM Chicago).

## Rollback
Revert the two files.

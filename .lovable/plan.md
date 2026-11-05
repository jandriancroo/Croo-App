# Offered shifts stay in the feed until approved or the shift ends

## What I found (checked in code and the live database)
- **Why started shifts vanish:** the feed's offer list (useOpenShiftOffers) drops any offer whose shift has already **started**, using store-local time.
- **Other screens:** the Shift Swaps bar and the feed card don't filter by time on their own. The offer dialog only creates offers and does no time filtering.
- **Approved offers are not hidden today.** The list includes `approved` offers and shows them as "Covered by …" until the shift starts. That breaks rule (1). Live there are 12 approved and 31 available offers.
- **Overnight shifts exist:** 713 scheduled shifts end after midnight (end time earlier than start time), so the end-time check must roll those over to the next day.
- **Michelle's offer (71342a1c…):** available, Nov 5, 2:00–8:30 PM, store time zone America/Chicago. Today it disappears at 2 PM.
- **Important side effect:** after a shift starts, the database already refuses a claim, a manager approval or an Assign (`_shift_has_started` is checked in the claim trigger, `approve_shift_offer` and `assign_shift_offer`). Rule changes are out of scope, so after start the offer will be **visible, but nobody can claim, approve or assign it**.

## The change
1. **useOpenShiftOffers.tsx**
   - Show an offer while its status is still open: `available` (nobody has claimed it) or `claimed` (claim waiting for approval).
   - Hide `approved` offers. That is rule (1): claimed and manager-approved.
   - Replace the "not started" check with "not ended". The shift ends at its date plus end time in the store's time zone, rolled to the next day when the end is at or before the start (overnight). The offer stays visible until that moment passes.
   - Fetch `end_time` along with the start time. If a shift has no end time, keep the current start-time behavior.
   - Starting the shift no longer hides it, and a claim without approval doesn't hide it either.
2. **OpenShiftCard.tsx** (screen text only)
   - Once the shift has started, replace the Claim and Assign buttons with a small "Shift started" label, because the database would reject those taps anyway.
   - If you'd rather keep the buttons, say so; tapping them after start would then show an error.
3. **src/lib/shiftMarketplace.test.ts:** replace the not-started tests with tests for the new rule. Times use Michelle's shift in Chicago time:
   - Before start (1:30 PM): visible.
   - After start, before end (3 PM): visible.
   - Claimed and waiting for approval (3 PM): visible.
   - Claimed and approved: hidden.
   - After end (8:31 PM): hidden.
   - Overnight shift 10 PM–2 AM: visible at 1 AM the next day, hidden at 2:01 AM.

No other files change. No database, schema, data, approval-flow, punch, kiosk or native/iOS changes. Old offers stay stored as history; the feed simply stops showing them.

## Verify
- Run the tests above and the build.
- In the preview, signed in, open Georgetown's feed and confirm Michelle's offer shows during its window (it's after 2 PM Chicago time now). No real claims or approvals will be made.
- After that, publish to croohq.com. I can't make commits myself; I'll report the last commit before this work.

## Rollback
Revert the three files.

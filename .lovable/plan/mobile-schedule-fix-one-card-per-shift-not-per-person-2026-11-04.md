# Mobile schedule fix: one card per shift, not per person

Only `src/components/schedule/MobileScheduleView.tsx` changes. No other files, no database changes, and `time_punches` stays read-only.

## What changes for managers
- If someone works two shifts in one day, the Now and Completed lists show two cards. Each card has its own times, breaks and hours.
- Their 2nd scheduled shift stays in **Later** until they clock in for it.
- With station grouping on, each card sits under the station of its own shift.
- Tapping a card opens only that shift.

## Blocks that change (and only these)

1. **`DayPunch` interface (~L121):** add optional `shiftId?: string | null`.

2. **`dayPunches` query, STEP 2 + STEP 3 (~L475–555):**
   - Keep STEP 1 grouping as it is. Keep the `matchesDate(clockIn)` filter for candidates.
   - Mark which groups are orphaned. A group is orphaned when it has no clock_out and is not the user's last group overall. Only the last open group can be active.
   - **Orphan choice: keep hiding orphaned groups, as today.** They have no clock-out, so their hours mean nothing, and showing them would add a new "missing clock-out" card state. Today these groups are already invisible unless one happens to be the only candidate. Managers still fix them in Payroll Review / Edit Shift. (If you'd rather see them, the alternative is a non-active card with no clock-out and 0 hours, placed in Completed. Say "show orphans" and I'll build that instead.)
   - Loop over every remaining candidate group and run the existing hours, unpaid-break and createdByName code on each one. Apply the >16h stale-active guard per group, which only affects the active (last open) group.
   - Scheduled-shift match for each group, worked out per user:
     a. use the group's `shiftId` if it is in `todayScheduledShifts`;
     b. otherwise use that user's scheduled shift on the date whose start is closest to the group's clock-in, skipping shifts already matched to another of that user's groups while an unused one is left. If none is left, reuse the closest one.
     Groups with a direct `shiftId` match are assigned first, then the rest go in clock-in order.
   - Push one DayPunch per group with `id` = that group's clock_in id, and `shiftId: scheduledShift?.id ?? group.shiftId ?? null`.
   - The business-date `filteredPunches` filter and the sort stay as they are.

3. **`toastPunches` map (~L607):** add `shiftId: null` only. Nothing else changes.

4. **`shiftForPunch` (~L243):** no code change needed. It already reads `punch.shiftId` first, and the user fallback now only applies to Toast and unmatched cards (same as today).

5. **LATER filter (~L1163–1168):** build a `coveredShiftIds` set before filtering.
   - Add every card's `scheduledShift.id` / `shiftId` that matches a shift in `dayShifts`.
   - For each card with no matched shift (Toast or unmatched punches), add that user's not-yet-covered shift in `dayShifts` whose start is closest to the card's clock-in.
   - Later shows `dayShifts` whose id is not in `coveredShiftIds`.
   - The future/past "Scheduled" list is not touched.

## Unchanged, confirmed by reading the code
- **EditPunchDialog: no change.** It loads the user's day and keeps only the punches from `clockInId` up to the next clock_in (~L111–127). All three tap handlers (~L1153, 1255, 1309) already pass `clockInId: punch.id`, which is now each group's own clock-in.
- **Counts:** "N ON THE CLOCK" (~L987) counts `isActive` cards. Only one open group per user can be active, so it still equals the number of people clocked in. Now/break/total and Completed (n) count cards.
- React keys stay `punch.id`, which is unique per clock-in.
- Payroll Review / Edit Shift, punch/kiosk/time-clock/Quick Punch logic, Toast mapping (except the null field), schema, RLS and edge functions are not touched.

## Verification
- Typecheck/build.
- Browser check on the mobile viewport, signed in as Jordan, viewing real store data read-only. No punches are created. Then a code walk-through of the cases below, since I won't add test punches to real stores:
  - two closed shifts → two cards whose hours add up to the day's total;
  - 2nd shift still open → one card in Now, one in Completed, the person counted once;
  - 2nd scheduled shift stays in Later after the 1st clock-in and leaves Later once they clock in for it;
  - single-shift people look exactly as before;
  - Hayward Toast cards are unchanged and read-only;
  - tapping each card opens only that shift.
- If you want an automated check, I can add a small test file for the grouping and matching. That would mean moving the logic into a helper, which adds a second file, so I'll only do it if you approve.

## Rollback
Revert the single-file change to `MobileScheduleView.tsx`.

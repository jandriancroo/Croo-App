# Fix Toast linked icon immediately

## What will change
- Make a saved Toast staff pairing immediately update that employee’s existing Toast shift cards.
- Make unlinking immediately remove the linked state from those cards.
- Keep the normal Toast refresh as a backup, not a requirement for the icon to appear.

## Verification
- Confirm Sam’s saved pairing and current shift use the same Toast identity.
- Confirm Sam’s current shift receives her CrooHQ profile link.
- Open the Hayward mobile schedule and verify the green link icon appears beside Sam without changing Toast punches.

## Technical details
- Add a database rule on Toast pairing changes that synchronizes matching read-only Toast shift rows by store and Toast employee ID.
- Backfill existing paired shifts once so Sam’s current card is corrected immediately.
- Do not modify punch times, wages, labor totals, the schedule, or any locked feature.

# Improve the sales summary scoreboard

## What will change
- Keep current sales on the left and place the status badge directly beside the sales amount.
- Move Goal into the center column where the status currently sits.
- Put Last Year at the upper right.
- Put Pace beneath Last Year, with an adjacent dollar and percentage comparison showing Pace versus Last Year.
- Apply the same arrangement to Today, Week, and Month.

## Behavior
- Today compares pace with the same day last year.
- Week compares end-of-week pace with the same week last year.
- Month compares end-of-month pace with the same month last year.
- Positive comparisons show an up indicator; negative comparisons show a down indicator; missing or zero last-year data shows no misleading percentage.
- Each period’s status uses that period’s pace versus goal, while preserving the existing status thresholds.

## Verification
- Check all three views with real dashboard data.
- Check the compact mobile layout for wrapping or overlap.
- Confirm the app reports no new errors.

No database changes and no publishing.

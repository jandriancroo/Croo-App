# Sales Summary centered scoreboard

## Step 0 findings
- `renderScoreboard()` is called exactly three times: Today, Week, and Month.
- `renderPaceVsLastYear()` is called only inside `renderScoreboard()`.
- `renderStatusBadge()` is defined but never called; it will be removed as dead code.
- All displayed values keep their existing sources: daily/weekly/monthly sales, their current goals and pace values, completed Last Year periods, existing prior-period comparisons, and existing status values.
- QU defines `prevDay` as the same weekday seven days earlier through the current hour, `prevWeek` as the previous full Monday–Sunday week, and `prevMonth` as the previous full calendar month.
- Cached non-QU feeds do not create a conflicting `prevDay`; they currently provide no comparison object, so those comparison chips remain hidden under the existing show/hide rule.
- No database, migration, access-policy, server function, query, hook, prop, calculation, or type changes are needed.

## Changes
1. Rebuild the single shared `renderScoreboard()` layout so Today, Week, and Month use the exact centered label, 44px sales figure, chip row, and three-column Last Year / Goal / Pace band.
2. Convert `renderPaceVsLastYear()` from a chip to the specified compact line beneath Pace, preserving its math and visibility rule.
3. Change only the three orange tile wrappers to `p-4`, update comparison wording to `Last Thu`-style / `Last Week` / `Last Month`, and center/enlarge Today’s update or delayed line.
4. Add Manrope weight 800 to both existing font links in `index.html`, leaving everything else unchanged.

## Verification
- Check TypeScript and the latest preview build result.
- Test Today, Week, and Month at a 390px phone width, including tile expand/collapse and the unchanged Labor % tab.
- Check default, dark, and OLED themes.
- Confirm large 5–6 digit values remain one line; the hero uses `whitespace-nowrap` with a small-width fallback size, and band values use `whitespace-nowrap` plus `min-w-0` so they shrink rather than wrap.
- Capture screenshots of all three views when live data permits.

## Files changed
- `src/components/dashboard/SalesSummary.tsx`
- `index.html`

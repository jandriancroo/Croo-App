# Payroll export: missing wage warns, never blocks

Change from the approved payroll plan. Everything else stays as built.

## New behavior
- If a person's wage is empty or 0:
  - Their row shows "wage missing".
  - Their gross wages are $0.00. Their hours still export in full.
  - The export still runs.
- No default wage anywhere. The math never substitutes $15 or any other number. The server already reports "wage missing" and never fills in a default; the screen keeps that as it is.
- A warning banner at the top of the Time Tracking payroll summary: "Wage missing for: <names>. Their gross wages show $0 — your payroll provider has the real rates."
- The CSV gets a note line after TOTALS: `Note: wage missing for <names> (gross wages shown as 0)`. The PDF shows the same note under the table.
- Today the list should be just Nikita Mehta (Georgetown).

## What stays blocking
- Shifts missing a clock-out still block the export, as in the approved plan.
- Payroll hours that are still loading or failed to load still block the export.

## Technical details
- `usePayrollData.tsx`:
  - Remove the wage-missing check from `checkExportReady`.
  - Wage stays 0 in the math, so gross = 0.
  - CSV: in the Hourly Wage cell, write "wage missing" instead of 0.00, and add the note row.
  - PDF: same cell text and the note line.
  - Expose `wageMissingNames` from the summary.
- `PayrollReview.tsx`: add the warning banner (Alert, destructive/warning styling from design tokens) above the Payroll Summary card when `wageMissingNames.length > 0`. The table's Gross cell shows $0.00 instead of "—".
- Server `payroll_hours`: no change.
- Protected files: no change. The checksum stays n=3702 / be1bd338…526c.

## Check
- Georgetown period: export runs, Nikita's row reads "wage missing" / gross 0, the note line lists her, and the banner shows her name.
- Grep confirms no `|| 15` or `?? 15` wage fallback in the payroll files.

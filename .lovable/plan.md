

## Fix: Business Date Logic Across CrooHQ

### The Problem
Six frontend components and one backend SQL function use raw calendar date (`getTodayInTimezone`) when they should use business date (`getBusinessDateInTimezone`). This causes features to "flip to tomorrow" the instant midnight hits at the store — even if the store is still open.

### What Changes

| # | File | Change |
|---|------|--------|
| 1 | **SalesSummary.tsx** | Replace `getTodayInTimezone()` and `format(new Date(), 'yyyy-MM-dd')` with `getBusinessDateInTimezone()` for "Today" default and data fetching |
| 2 | **CateringOrdersAlert.tsx** | Use business date for determining "today's" and "tomorrow's" catering orders |
| 3 | **useTasksData.tsx** | Use business date for task badge counts |
| 4 | **DynamicChecklistCalendar.tsx** | Use business date for "today" highlight and current week calculation |
| 5 | **PostClockInTasks.tsx** | Use business date for loading the correct day's post-clock-in tasks |
| 6 | **ManagerDashboardOverlay.tsx** | Use business date for sales data key, labor cuts key, and event display |
| 7 | **send_hourly_sales_pulse** (SQL function) | Sum Goal/Pace from `hourly_projections` JSONB instead of stale single-value columns |

### What Stays the Same (no changes needed)
- **Schedule views, punch clock, QuickPunchDialog** — correctly use raw calendar dates
- **Logbook and Dashboard checklist logic** — already using business date

### Technical Details
- All six frontend files swap `getTodayInTimezone()` calls for `getBusinessDateInTimezone()` from the `useLocationTimezone()` hook (or the direct util with timezone + closeTime args where the hook isn't available)
- The SQL pulse function will parse the `hourly_projections` JSONB array to calculate Goal (full sum) and Pace (actuals + remaining projections), matching the frontend Sales Summary logic
- If `closeTime` is null for any location, business date falls back to raw calendar date — identical to current behavior

### Risk
Low. `getBusinessDateInTimezone()` is already battle-tested in Dashboard and Logbook. No schema changes required.

### After Implementation
Update the project knowledge timezone rule from "All dates/times use America/Los_Angeles for Blaze locations" to reflect:
- Each location uses its own timezone (auto-detected from address on creation)
- "Today" means the **business date** — doesn't roll over until after store close + buffer
- Only schedule/punch-clock features use raw calendar dates
- `getBusinessDateInTimezone()` is the standard for all "what day is it at this store?" logic


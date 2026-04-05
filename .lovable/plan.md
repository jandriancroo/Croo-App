

## Fix: Business Date Logic Across CrooHQ

### The Problem
Six frontend components and one backend SQL function use raw calendar date (`getTodayInTimezone`) when they should use business date (`getBusinessDateInTimezone`). This causes features to "flip to tomorrow" the instant midnight hits at the store — even if the store is still open.

### What Changes

| # | File | Change |
|---|------|--------|
| 1 | **SalesSummary.tsx** | Replace `getTodayInTimezone()` and `format(new Date(), 'yyyy-MM-dd')` with `getBusinessDateInTimezone()` for "Today" default and data fetching |
| 2 | **CateringOrdersAlert.tsx** | Use business date for "today's" and "tomorrow's" catering orders |
| 3 | **useTasksData.tsx** | Use business date for task badge counts |
| 4 | **DynamicChecklistCalendar.tsx** | Use business date for "today" highlight and current week calc |
| 5 | **PostClockInTasks.tsx** | Use business date for post-clock-in task list |
| 6 | **ManagerDashboardOverlay.tsx** | Use business date for sales data key, labor cuts key, and events |
| 7 | **send_hourly_sales_pulse** (SQL) | Sum Goal/Pace from `hourly_projections` JSONB instead of stale single-value columns |

### What Stays the Same
- Schedule, punch clock, QuickPunchDialog — correctly use calendar dates
- Logbook and Dashboard checklist logic — already on business date

### Risk
Low. `getBusinessDateInTimezone()` is battle-tested in Dashboard/Logbook. If `closeTime` is null, it falls back to raw calendar date (same as current behavior). No schema changes needed for frontend fixes; the SQL function update is logic-only.

### After Implementation
Update project knowledge to replace the outdated "All dates/times use America/Los_Angeles" rule with:
- Each location uses its own timezone (auto-detected from address on creation)
- "Today" = **business date** (doesn't roll until after close + buffer)
- Only schedule/punch-clock uses raw calendar dates
- `getBusinessDateInTimezone()` is the standard for all "what day is it?" logic


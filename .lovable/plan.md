

## Fix: Business Date Logic Across CrooHQ

### The Problem
Six frontend components and one backend SQL function use raw calendar date (`getTodayInTimezone`) when they should use business date (`getBusinessDateInTimezone`). This causes features to "flip to tomorrow" the instant midnight hits at the store, even if the store is still open.

### What Changes

**1. SalesSummary.tsx** — Replace `getTodayInTimezone()` and `format(new Date(), 'yyyy-MM-dd')` with `getBusinessDateInTimezone()` for the "Today" selector default and data fetching.

**2. CateringOrdersAlert.tsx** — Use business date for determining "today's" and "tomorrow's" catering orders.

**3. useTasksData.tsx** — Use business date for the task badge count so it matches what the user sees on the Tasks page.

**4. DynamicChecklistCalendar.tsx** — Use business date for the "today" highlight and current week calculation.

**5. PostClockInTasks.tsx** — Use business date for loading the correct day's post-clock-in tasks.

**6. ManagerDashboardOverlay.tsx** — Use business date for the overlay's sales data, labor cuts key, and event display.

**7. send_hourly_sales_pulse SQL function** — Rewrite Goal/Pace to sum from `hourly_projections` JSONB instead of stale single-value columns (the pulse notification fix).

### What Stays the Same
- Schedule, punch clock, QuickPunchDialog — correctly use calendar dates
- Logbook and Dashboard checklist logic — already on business date

### Risk
- Low — `getBusinessDateInTimezone()` is already proven in Dashboard/Logbook
- Fallback: if `closeTime` is null, defaults to raw calendar date (same as now)

### After Implementation: Update Project Knowledge
Replace the outdated timezone rule ("All dates/times use America/Los_Angeles for Blaze locations") with:
- Each location has its own timezone (auto-detected from address)
- "Today" means the **business date** — doesn't roll over until after close + buffer
- Only schedule/punch-clock features use raw calendar dates
- `getBusinessDateInTimezone()` is the standard for "what day is it at this store?"


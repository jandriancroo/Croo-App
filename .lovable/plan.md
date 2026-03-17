
## Scaling Optimization Roadmap

### ✅ Phase 1 — Completed (March 2026)

**Indexes Added (40+ composite indexes):**
- sales_cache, labor_cache, time_punches, checklists, alert_queue, maintenance_queue, email_queue, logbook, alarm tasks, user_locations, user_roles, messages, chat_members, availability, wages, tips, notifications, certifications, writeups, location_hours

**Queue Functions Rewritten (FOR loops → set-based SQL):**
- `queue_nightly_maintenance()` — single bulk INSERT instead of per-location loop
- `queue_nightly_emails()` — single bulk INSERT with EXISTS subquery instead of per-location loop

### 🔲 Phase 2 — Before 40 Locations

**Rewrite `check_alerts_sql()` to set-based:**
- Current: FOR loop iterates each location, runs nested queries per checklist
- Target: Single CTE-based query that checks all locations/checklists in one pass, bulk-inserts into alert_queue
- Risk: Medium (complex function with many alert types)

**Rewrite `trigger_alarm_tasks_sql()` to set-based:**
- Current: FOR loop per alarm task with time window calculations
- Target: Window functions + joins to process all tasks in parallel
- Risk: Medium (touches alarm task system — verify with locked features list)

**Rewrite `send_hourly_sales_pulse()` to set-based:**
- Current: FOR loop per location with sales/labor lookups
- Target: Single query joining locations → sales_cache → labor_cache → user_roles

**Stagger QuBeyond Sales Sync:**
- Hash location_id to offset sync timing across the 7-min window
- Implementation: Add offset calculation to sales-service edge function

### 🔲 Phase 3 — Before 100 Locations

- Connection pooling awareness in edge functions
- Read replicas for dashboard reads
- Regional sharding for maintenance/alert processing

---

## Make Checklist Completion More Robust on Manager Dashboard

### Problem
The checklist section in the Punch Clock Manager Dashboard currently shows a simple complete/incomplete indicator (circle vs checkmark) with no progress detail. The data already includes `completedItems` and `totalItems` counts from the query, but the UI doesn't display them.

### Changes

**File: `src/components/punchclock/ManagerDashboardOverlay.tsx`** (lines ~1536-1566)

Update the checklist row rendering to show:

1. **Progress fraction** instead of just a frequency badge — display `3/7` or `Done` when complete
2. **Mini progress bar** under the checklist title showing visual completion percentage
3. Keep the green checkmark circle for fully complete items and the open circle for incomplete ones

The updated row layout:

```text
[Circle] Checklist Title          [3/7]
         [======----] progress bar
```

- Replace the badge content from `frequency` to `{completedItems}/{totalItems}` when incomplete, and `Done` when complete
- Add a thin progress bar (2px height) below the title using the existing `Progress` component or a simple styled div
- Color coding: green for 100%, yellow/amber for partial, muted for 0%

### Technical Details

- The query at line 499 already returns `completedItems` and `totalItems` per checklist — no backend changes needed
- Only the JSX rendering block (lines 1536-1566) needs modification
- Uses existing `isDayMode` theme logic for proper dark/light styling
- Progress bar width calculated as `(completedItems / totalItems) * 100`


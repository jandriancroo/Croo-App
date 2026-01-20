# CrooHQ Punch Clock System Documentation

## Overview

The punch clock system tracks employee time through the `time_punches` table in Supabase. All times are stored in UTC and displayed in the location's timezone (America/Los_Angeles for Blaze locations).

---

## Punch Types

There are **4 punch types** stored in the `punch_type` column:

| Type | Description |
|------|-------------|
| `clock_in` | Employee starts their shift |
| `clock_out` | Employee ends their shift |
| `break_start` | Employee starts a break (10 min paid OR 30 min unpaid) |
| `break_end` | Employee ends their break |

---

## Punch Flow for a Complete Shift

1. **Clock In** → Employee enters PIN, starts shift
2. **Break Start** (optional) → Employee starts 10 or 30 minute break
3. **Break End** (optional) → Employee returns from break (or clock_in resumes after break)
4. **Clock Out** → Employee ends shift

---

## Clock In Rules

These rules are now **configurable per-location** in Settings → Labor Rules:

| Setting | Default | Description |
|---------|---------|-------------|
| `allow_unscheduled_clock_in` | `true` | Can employees clock in without a scheduled shift? |
| `allow_early_clock_in` | `true` | Can employees clock in before shift start? |
| `early_clock_in_minutes` | `30` | How many minutes early (only if early clock-in enabled) |

| Condition | Result |
|-----------|--------|
| Employee already clocked in (last punch = `clock_in`) | ❌ Cannot clock in again |
| No scheduled shift + `allow_unscheduled_clock_in: false` | ❌ Cannot clock in |
| No scheduled shift + `allow_unscheduled_clock_in: true` | ✅ Can clock in (flagged for payroll review) |
| Scheduled shift + `allow_early_clock_in: false` + before shift start | ❌ Cannot clock in yet |
| Scheduled shift + `allow_early_clock_in: true` + more than X mins before start | ❌ Cannot clock in yet |
| Scheduled shift + within allowed early window or after start | ✅ Can clock in |

### What Happens on Clock In:
- Inserts a `clock_in` punch with current timestamp
- Links to `shift_id` if scheduled shift exists (null otherwise)
- Sets `created_by` to the employee's user ID (self-punch)
- Triggers post-clock-in tasks screen (alarm tasks, etc.)

---

## Break Rules

### Starting a Break:
- Only available when employee is clocked in (`lastPunch.punch_type === 'clock_in'`)
- Two break types:
  - **10 minute (paid)**: Notes = "10 minute paid break"
  - **30 minute (unpaid)**: Notes = "30 minute unpaid break"

### Ending a Break:
- Employee must wait the **full break duration** before ending
- If 30 min break started at 12:00, cannot end until 12:30
- Shows countdown timer while on break

### Break Status Logic:
```
If lastPunch.punch_type === 'break_start':
  - Calculate break duration from notes (10 or 30 minutes)
  - Calculate time remaining = breakEndTime - now
  - If remaining <= 0: can end break
  - If remaining > 0: must wait (shows timer)
```

---

## Clock Out Rules

| Condition | Result |
|-----------|--------|
| Employee is on break | ❌ Must end break first |
| Employee is clocked in | ✅ Can clock out |
| Employee already clocked out | ❌ Cannot clock out again |

### What Happens on Clock Out:
- Inserts a `clock_out` punch with current timestamp
- Links to same `shift_id` as the clock_in
- Non-admin employees return to PIN screen after 2 seconds
- Admins stay on action screen

---

## Auto Punch-Out System (v2 - Safe Implementation)

The `auto-punch-out` edge function runs **once daily at 3 AM PST** as part of `nightly-maintenance` and safely clocks out employees who forgot to punch out.

### Key Safety Features:
- **Business-hours aware**: Uses `location_hours.close_time` + 3 hour buffer (not arbitrary times)
- **Runs once daily**: No race conditions from frequent polling
- **Shift validation**: Only auto-punches shifts between 4-16 hours
- **Detailed logging**: Every decision is logged with reasons
- **Cache integration**: Marks `labor_cache` as stale after auto-punching

### Configuration:
- Uses `location_hours` table (close_time per day of week)
- Buffer: 3 hours after close time
- Minimum shift: 4 hours (shorter shifts skipped)
- Maximum shift: 16 hours (longer shifts skipped, likely error)

### How It Works:

1. **Runs at 3 AM PST** via `nightly-maintenance` cron
2. **For each location**, gets yesterday's `close_time` from `location_hours`
3. **Finds open clock-ins** from yesterday (no matching clock_out after)
4. **For each open punch:**
   - Calculate shift duration (clock_in to now)
   - Skip if < 4 hours (too short, likely data issue)
   - Skip if > 16 hours (too long, likely error)
   - Otherwise, auto-punch at `close_time + 3 hours`

5. **Creates clock_out punch with:**
   - `is_auto_punched_out: true`
   - `notes: 'Auto clocked out by system - 3 hours post-close (22:00)'`
   - `has_break_violation: true` (if shift > 5 hours)

6. **Marks `labor_cache` as stale** so backfill recalculates hours

### Example:

```
Location: Blaze Pasadena
Yesterday's close time: 22:00 (10 PM)
Buffer: 3 hours

Employee clocks in Jan 9 at 6:00 PM, forgets to clock out:
- Clock in: Jan 9 at 6:00 PM PST
- Location close: Jan 9 at 10:00 PM PST
- Auto-punch time: Jan 10 at 1:00 AM PST (close + 3 hrs)
- Shift duration: ~7 hours ✓ (within 4-16 hr range)
- Result: AUTO-PUNCH at Jan 10 1:00 AM
```

### What Gets Skipped (with logging):

| Scenario | Reason |
|----------|--------|
| Shift < 4 hours | Too short, likely test/error |
| Shift > 16 hours | Too long, likely forgot previous day too |
| Already has clock_out | Employee punched out normally |
| Location closed yesterday | No `close_time` for that day |
| No hours configured | Missing business hours in `location_hours` |

---


## Manual Punch Editing (Edit Punch Dialog)

Managers can edit punches via the Schedule or Time Tracking pages.

### Capabilities:
- Edit clock in/out times for any day
- Add or remove breaks
- Add clock out if missing
- Delete entire punch record
- Changes are logged

### Punch Editing Rules:
- All 4 punches for a shift are fetched and displayed
- Times displayed in location's timezone
- Saving updates or inserts punches as needed

---

## Important Database Fields

### `time_punches` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Employee's profile ID |
| `location_id` | UUID | Location where punch occurred |
| `shift_id` | UUID | Linked scheduled shift (nullable) |
| `punch_type` | TEXT | `clock_in`, `clock_out`, `break_start`, `break_end` |
| `punch_time` | TIMESTAMPTZ | When the punch occurred (UTC) |
| `notes` | TEXT | Break type, auto-punch notes, etc. |
| `is_auto_punched_out` | BOOLEAN | True if auto-punched by system |
| `has_break_violation` | BOOLEAN | True if worked >5 hrs without break |
| `created_by` | UUID | Who created the punch (self or manager) |

---

## Time Tracking Display (History.tsx / PayrollReview.tsx)

When displaying punches:

1. **Fetch all punches** for employee + date range
2. **Group by date** in location's timezone
3. **Find pairs:**
   - First `clock_in` of the day
   - Last `clock_out` of the day
   - Any `break_start` / `break_end` pairs
4. **Calculate hours:**
   - Total time = clock_out - clock_in
   - Subtract unpaid break time (30 min breaks)
   - Paid breaks (10 min) don't reduce hours

---

## UI Indicators

| Indicator | Meaning |
|-----------|---------|
| "Auto" badge (orange) | Employee was auto-clocked out |
| Break violation warning | Worked >5 hours without meal break |
| "Off schedule" | Clocked in without a scheduled shift |
| Green times | Normal punch times |
| Orange/red times | Edited, auto-punched, or violations |

---

## Edge Cases Handled

1. **Overnight shifts**: Clock in on Jan 9 PM, clock out on Jan 10 AM
2. **Missed punches**: Auto-punch catches up to 48 hours back
3. **Multiple clock-ins**: Only most recent clock_in without clock_out is "open"
4. **Break as clock_in**: Some systems use clock_in to end a break instead of break_end
5. **Very long shifts**: >16 hour shifts are skipped by auto-punch (likely error)

---

## Summary: What Makes a Complete Shift

```
✅ Valid shift:
   clock_in (6:00 PM) → [optional break] → clock_out (1:30 AM)

✅ With meal break:
   clock_in (6:00 PM) → break_start (10:00 PM) → break_end (10:30 PM) → clock_out (1:30 AM)

✅ Auto-punched:
   clock_in (6:00 PM) → [forgot to punch out] → clock_out (2:00 AM, is_auto_punched_out: true)

❌ Incomplete (will be auto-punched):
   clock_in (6:00 PM) → [no clock_out]
```

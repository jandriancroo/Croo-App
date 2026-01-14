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

## Auto Punch-Out System

The `auto-punch-out` edge function runs via cron and automatically clocks out employees who forgot to punch out.

### Configuration:
- Set in `labor_rules` table under `auto_punch_out_time` column
- Format: `HH:MM:SS` (e.g., `02:00:00` for 2:00 AM)
- Currently set to **2:00 AM** for Blaze locations

### How It Works:

1. **Runs every minute** via cron job
2. **Checks each location** that has `auto_punch_out_time` configured
3. **Looks back 48 hours** for any open `clock_in` punches without matching `clock_out`
4. **For each open punch:**

   **If the clock_in is from a PREVIOUS day:**
   - Sets auto-punch time to `auto_punch_out_time` on the day AFTER the clock_in
   - Example: Clocked in Jan 9 at 6 PM → Auto-punched Jan 10 at 2:00 AM
   
   **If the clock_in is from TODAY and past auto-punch time:**
   - Auto-punches at today's `auto_punch_out_time`
   - Only if the clock_in was before the auto-punch time

5. **Sanity Checks:**
   - Skips shifts that would be > 16 hours (likely data error)
   - Checks for meal break violations (if worked > 5 hours without break)

6. **Creates clock_out punch with:**
   - `is_auto_punched_out: true`
   - `notes: 'Auto clocked out by system'`
   - `has_break_violation: true` (if applicable)

### Auto-Punch Time Calculation Example:

```
Location timezone: America/Los_Angeles
Auto punch time: 02:00:00 (2 AM)

Scenario 1: Anthony clocks in Jan 9 at 6:00 PM PST (02:00 UTC Jan 10)
- Clock in local date: Jan 9
- Today local date: Jan 10
- Since clock_in date < today: AUTO-PUNCH
- Punch time = Jan 10 at 2:00 AM PST (10:00 UTC)

Scenario 2: Employee clocks in Jan 10 at 8:00 AM, current time is 11:00 AM
- Clock in local date: Jan 10
- Today local date: Jan 10
- isPastAutoPunchTime: false (11 AM < 2 AM next day)
- NO AUTO-PUNCH (shift still valid)
```

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

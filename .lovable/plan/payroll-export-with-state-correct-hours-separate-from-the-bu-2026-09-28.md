# Payroll export with state-correct hours (separate from the bundle)

Plan only. The bundle publish still waits for Jordan's "publish". This build does not publish anything by itself.

## Step 0 findings (checked against live code and database)

**Callers**
- `calculatePayrollSummary`, `exportToCSV`, `exportToPDF` are defined only in `src/hooks/usePayrollData.tsx` (lines ~1543, 1679, 1705) and used only by `src/pages/PayrollReview.tsx` (the export menu at ~330/334 and the summary table at ~355–373, which calls `calculatePayrollSummary()` six times per render).
- No edge function or other screen uses them.

**Confirmed bugs in the live code**
1. DT is computed (`doubleOvertimeHours`) but the CSV/PDF headers omit it.
2. Weekly OT = `max(dailyOT, total − 40)`, and `total` includes DT hours.
3. The week is hardcoded Mon–Sun (`getWeekStartForDate`, `groupPunchesByWeek` map Mon=0).
4. `wage = card.profile.hourly_wage || 15`.
5. No 7th-day rule. 6. No NV wage cutoff.
- Also: hours come from browser punch math (`calculateDayHours`), not the server shift list; PTO is summed by `start_date` inside the period only.

**labor_rules columns in use**
- Hours math: daily_overtime_threshold, daily_double_time_threshold, weekly_overtime_threshold, overtime_multiplier, double_time_multiplier (usePayrollData, payrollCalculations, laborCalculations, LaborTotals, DayInsightsBar, LaborRulesSection, DeployLocationWizard).
- Breaks: meal_break_hours, meal_break_duration, unpaid_break_min_minutes.
- Pay period: pay_period_type, pay_period_start_date.
- Punch/auto-out (not touched): auto_clock_out_after_close_min, auto_punch_out_time, max_open_shift_hours, duplicate_tap_minutes, early/unscheduled clock-in, reporting_time_*, rest_break_*.

**Workweek and pay period storage**
- There is **no workweek setting anywhere**. The only week column is `schedules.week_start_date`. Mon–Sun is hardcoded in the client.
- Pay period = `labor_rules.pay_period_type` (all stores: biweekly) + `labor_rules.pay_period_start_date`. Only Georgetown (2026-07-19), Palm Desert and Palm Springs (2025-12-08) have a start date; every other store is NULL and the client silently falls back to 2025-11-03. Period periods are generated in the browser; `pay_periods` only stores open/closed status.

**labor_shifts suitability**
- `labor_shifts(_location_id, _start, _end)` returns per shift: user_id, business_date, paid_hours, wage, wage_missing, resolved_zero, missing_clock_out, estimated_end/estimated, ot_hours, dt_hours. Summing paid_hours by (user_id, business_date) gives paid hours per person per business day. Yes, it works.
- It already uses the server business-date bucketing and resolutions (Resolve as 0h), so payroll_hours will match Time Tracking and the dashboard.
- Its ot_hours/dt_hours are daily-only (Stage 4) — payroll_hours ignores them and reclassifies from paid_hours.

## Things Jordan should decide

1. **Nevada cutoff amount (required).** What dollar amount goes in `daily_ot_max_wage` for Reno Diamond Pkwy, South Meadows, Sparks and Virginia St? (NV rule is 1.5 × state minimum wage; I'm not guessing it.) Until answered it stays NULL, which means NV daily OT applies to everyone — same as today.
2. **Open shifts (assumption).** A shift still missing a clock-out counts at its estimated end, and the export is blocked with "N shifts need a clock-out" until resolved. Please confirm, or say to export with estimates.
3. **Pay-period start for stores with no date (assumption).** Keep the existing 2025-11-03 fallback so no period dates move. payroll_hours takes the period's start/end from the screen, as now.
4. **Dates before 9/26 (assumption).** Hours before 9/26 use labor_shifts as-is (old break rule for 9/21–9/25, labeled "old rule"). Exports for fully closed old periods may differ slightly from what was exported then; nothing stored changes.

## Build

### A) Server function `payroll_hours(_location_id uuid, _start date, _end date)`
- SECURITY DEFINER, `SET search_path = public, pg_temp`. REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE to authenticated, service_role, sandbox_exec_lmodeiyrpwvgyqcvjkjr.
- Gate: service role; org admin of the store's org (or super_admin); or `has_role_or_higher(uid,'manager')` with `has_location_access(uid, loc)`. Otherwise 42501.
- Reads `labor_shifts(_location_id, week_start(_start), week_start(_end)+6)` — full workweeks on both ends — excludes resolved_zero, sums paid_hours per (user, business_date).
- PTO: approved availability_requests (paid/vacation/sick) at the store, same filter as today.
- Wage: current wage per user (same source labor_shifts uses); `wage_missing` when null/0; never a default.
- Returns one row per employee: user_id, full_name, wage, wage_missing, regular_hours, ot_hours, dt_hours, pto_hours, total_paid_hours, open_shift_count, weeks jsonb (per workweek: week_start, days worked, total, reg, ot, dt, hours inside this period).

### B) Rules, per employee per workweek, in order
1. Daily: above daily_overtime_threshold (if > 0) is OT, up to daily_double_time_threshold; above daily_double_time_threshold (if > 0) is DT.
2. 7th day (seventh_day_rule = true): if the employee worked all 7 days of the workweek, day 7's first 8h are OT and the rest DT (replaces step 1 for that day).
3. Weekly: OT = max(daily OT from 1–2, total − DT − weekly_overtime_threshold). Regular = total − OT − DT. DT never counts toward 40.
4. NV cutoff: if daily_ot_max_wage is set and wage ≥ it, skip steps 1–2; step 3 still applies.
- Workweek start = labor_rules.workweek_start_dow (0=Sun … 6=Sat, default 1=Mon).
- Boundary weeks: the week is classified with all 7 days; then each day's reg/OT/DT is assigned to that day. Weekly OT not tied to a day is placed on the latest days of the week (chronological, last hours first become OT), so hours are split between periods by the day they fall on. Only days inside [_start, _end] are returned in totals.

### C) Settings (migration adds columns; values set by data update, shown first)
- New columns on labor_rules: `seventh_day_rule boolean NOT NULL DEFAULT false`, `daily_ot_max_wage numeric NULL`, `workweek_start_dow smallint NOT NULL DEFAULT 1` (check 0–6).
- Seed: seventh_day_rule = true for Anaheim, Hemet, Palm Desert, Palm Springs only (not [TEST] Sandbox). NV daily_ot_max_wage stays NULL. Everything else unchanged. Current values of every row are listed before and after.
- Labor Rules settings screen gets the three fields (edit only; same write policy).

### D) Frontend
- `usePayrollData`: new `usePayrollHours(period)` query (refetch off on focus, like the review panel). `calculatePayrollSummary` becomes a thin mapper over it (computed once and memoized, not six times). Delete the browser OT/DT math and the `|| 15`.
- Gross = reg×wage + OT×wage×ot_mult + DT×wage×dt_mult + PTO×wage; tips unchanged (employeeTipShares).
- CSV and PDF columns: Employee, Hourly Wage, Regular Hours, Overtime Hours, Double Time Hours, PTO Hours, Tips, Gross Wages, Total Compensation, plus a TOTALS row.
- Missing wage: row shows "wage missing"; Export CSV/PDF shows "Can't export: add a wage for <names>" and stops. Open shifts block the same way (see question 2).
- Pay-period cards keep hours/$ from get_store_labor (dashboard parity) and add Reg/OT/DT from payroll_hours.
- PayrollReview summary table adds a DT column.

### E) Do not touch
time_punches triggers, PunchClock.tsx, src/components/punchclock/, liveLabor.ts, kioskCutSavings.ts, punch-device-service, auto clock-out (run_auto_clock_out, settings/log, cron), ManagerDashboardOverlay.tsx, labor_shifts / _labor_pair_shifts / labor-service. No new cron. No write to labor_cache.

## Tests (synthetic, each in a DO block that ends in RAISE EXCEPTION so nothing stays)
Test harness: `_payroll_classify(days jsonb, rules jsonb, wage)` — the pure classifier payroll_hours calls, tested directly (same code path), plus one end-to-end run on [TEST] Sandbox with fake punches rolled back.
1. CA 14 + 4×8 → reg 40, OT 4, DT 2.
2. CA 7×8 → reg 40, OT 16, DT 0.
3. CA 7th day 10h → day 7: OT 8, DT 2.
4. TX 5×10 → reg 40, OT 10, DT 0.
5. NV under cap, 10h → OT 2; at/over cap, 10h → 0 daily OT; 5×10 at/over cap → OT 10 weekly.
6. Week crossing a period boundary: OT in period A + OT in period B = OT of the whole week; nothing lost or doubled.
7. Real Hemet last closed pay period: CSV reg + OT + DT = Σ labor_shifts paid_hours in the period (to the cent); gross = Σ hours × rate × multiplier; per-person total = Time Tracking total.
Also: 42501 for a user without access; proacl has no anon/PUBLIC; labor_cache checksum before 9/26 = n=3702 / be1bd3380da920b25abdc827c2ad526c before and after; `git diff --stat` lists none of the do-not-touch files.

## Rollback
DROP FUNCTION payroll_hours and _payroll_classify; leave the new columns (harmless defaults) or DROP them; revert the frontend commit.

## Files
- New migration: labor_rules columns, `_payroll_classify`, `payroll_hours`, grants.
- Data update: seventh_day_rule for the 4 CA stores.
- `src/hooks/usePayrollData.tsx` (summary, CSV, PDF, remove $15 fallback).
- `src/hooks/usePayrollHours.ts` (new).
- `src/pages/PayrollReview.tsx` (DT column, export block messages, cards).
- `src/components/settings/LaborRulesSection.tsx` (three new fields).
- `src/integrations/supabase/types.ts` (auto-generated).

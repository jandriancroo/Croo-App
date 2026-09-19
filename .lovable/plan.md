# Real labor $ for shift managers, wages never leave the server (SHIP — awaiting write confirmation)

## Problem (confirmed)

`fetchLiveLaborForToday` and `fetchActualLaborForDates` call `get_current_wages_batch`, which
masks every wage to $15 for anyone below `manager`. Shift managers can view sales/labor
(`canViewSalesAndLabor`) but not wages, so their Labor % is wrong — e.g. Palm Springs: Joey
(admin) 36.7% ≈ $262 vs Andrea (shift_manager_in_training) 27.2% ≈ $194 on the same $715 sales.

## What we build

### 1. Two new aggregate-only RPCs (migration, SECURITY DEFINER)

**`get_live_labor_totals(_location_id uuid, _date date)`** → `TABLE(hours numeric, cost numeric)`

- Gate: caller must be `shift_manager` or higher (`has_role_or_higher(auth.uid(), 'shift_manager')`)
  AND have membership at `_location_id` (`user_locations`). Otherwise returns empty / raises
  `permission denied`. Mirrors the kiosk-wages authorization pattern.
- Compute server-side: punches for the business date (timezone from `location_settings`, same
  bucketing rules as `fetchLiveLaborForToday` — open punches and open breaks count through
  `now()` for today, closed pairs only for past dates), breaks unpaid, hours × real wage
  resolved from `wage_history` (fallback `profiles.hourly_wage`, fallback 15) ignoring caller
  role for the wage lookup.
- Returns exactly one row: `{ hours, cost }`. No user IDs, no wages, no maps.

**`get_labor_totals_for_dates(_location_id uuid, _dates date[])`** → `TABLE(date date, hours numeric, cost numeric)`

- Same gate and same math, but for closed-day gap fills (week views): open punches do **not**
  count through now. One row per requested date.

### 2. Client rewiring (`src/utils/liveLabor.ts`)

- `fetchLiveLaborForToday` default path: call `get_live_labor_totals` instead of fetching
  punches + `get_current_wages_batch` client-side. Keep the `wageSource: 'kiosk'` branch
  untouched (punch-clock overlay already fixed).
- `fetchActualLaborForDates`: call `get_labor_totals_for_dates`; same aggregate-only rule.
- All existing callers (SalesSummary, LaborTotals, DayInsightsBar, CompactDashboard,
  useOrgDashboardData, usePersonalPayData, etc.) inherit the fix automatically.

### 3. CompactDashboard labor-cuts path

`src/components/dock/CompactDashboard.tsx` lines ~340/354/629/1089 ship per-employee
`hourly_wage` to the client to estimate "cost saved" when cutting someone. This leaks a
(masked, wrong) per-person rate and breaks the privacy rule.

- Replace with a sibling aggregate RPC **`get_cut_savings_estimate(_location_id uuid, _cuts jsonb)`**
  (jsonb = `[{user_id, minutes}]`) that returns per-cut dollar savings computed with real wages
  server-side — savings amounts only, never rates. The dock shows the same savings numbers,
  correct for every role.

### 4. Explicitly untouched

- `get_current_wages_batch` — not loosened.
- `labor_cache` / `sales_cache` writes, sources, unique constraints — untouched.
- Profile / UserManagement wage visibility — unchanged; shift managers still see no wages.
- Locked features, kiosk `wageSource: 'kiosk'` path, schedule labor surfaces — untouched.

## Verification

- Andrea-class (shift_manager_in_training) and Joey-class (admin) sessions show identical
  Labor % / Labor $ on Summary for the same location and moment (Palm Springs repro).
- Network tab on a shift-manager session: no `hourly_wage` payload anywhere on the Summary
  labor fetch.
- Team member with `view_sales` off: RPCs return permission denied; Summary shows no labor.
- Week view gap-fill matches `labor_cache`-backed days.
- Publish to croohq.com after write, per ship note.

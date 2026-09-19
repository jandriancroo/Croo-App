# Wage-mask audit: punch clock vs phone Summary (findings only, no code)

## Conclusion first

The $15 wage mask was **not** punch-clock-only. Yesterday's `kiosk-wages` ship fixed the
paired punch-clock screen completely, but the phone Dash Summary still resolves **today's**
labor dollars through `get_current_wages_batch`, which masks every wage to a flat $15 for
anyone below the `manager` role. So:

- Manager / GM / admin / org_admin / brand_admin / super_admin on the phone -> real wages, correct Labor %.
- Shift manager, shift manager in training, or team member with the "view sales" permission -> $15-masked wages for today only -> a wrong (usually inflated, sometimes deflated) Labor % on the phone Summary.
- Every completed day is unaffected on both surfaces (server-computed `labor_cache`).

## 1. Manager Dashboard overlay (punch clock Dynamic Manager)

`src/components/punchclock/ManagerDashboardOverlay.tsx`

- On-shift employee wages: `supabase.functions.invoke('kiosk-wages', ...)` (line ~426); when it returns nothing, `hourlyWage` is set to `null` rather than a fake number.
- Today's live labor dollars: `fetchLiveLaborForToday(...)` called with the kiosk wage source (the `live-labor-today` query, line ~479), so it also routes through `kiosk-wages`.
- `get_current_wages_batch` does not appear anywhere in this file. **No mask path remains on this screen.**

Server side: `supabase/functions/kiosk-wages/index.ts` authorizes either a paired device
(`punch_clock_devices.auth_user_id`) or a manager-or-higher human with membership at that
location, then reads `wage_history` / `profiles.hourly_wage` with the service role. Its own
comment states that `get_current_wages_batch` is unusable there because `auth.uid()` is null.

## 2. Phone Dash Summary (Labor %)

`src/components/dashboard/SalesSummary.tsx`

- Completed days (day / week / month rows): `labor_cache`, preferring `source = 'punch_clock'` over `qubeyond` / `aloha` / `clover` (lines ~190-207, ~395-410).
- **Today**: `fetchLiveLaborForToday(currentLocation.id, locationZone)` at lines 237 and 720 — called **without** `{ wageSource: 'kiosk' }`.
- `src/utils/liveLabor.ts` therefore takes the default branch and calls `supabase.rpc('get_current_wages_batch', ...)` (line 80). `fetchActualLaborForDates` (gap-fill for closed days) uses the same RPC at line 151.

## 3. Does `get_current_wages_batch` return real wages on the phone?

Live definition (verified in the database): it computes
`v_privileged := auth.uid() IS NOT NULL AND has_role_or_higher(auth.uid(), 'manager')`
and returns `15.00` for every user when not privileged (the caller's own row is always real).

`has_role_or_higher(..., 'manager')` accepts only `manager, general_manager, admin, org_admin,
fbc, brand_admin, super_admin`. `shift_manager` and `shift_manager_in_training` are **excluded**.

Meanwhile `src/hooks/useTeamSalesVisibility.tsx` shows the Summary to `isShiftManager` and above,
plus team members holding the `view_sales` permission. That gap — visible to shift managers,
real wages only for managers — is exactly where the mask still bites.

## 4. Paired punch-clock device session (no manager role)

| Surface | Wage source | Result |
|---|---|---|
| Manager Dashboard overlay | `kiosk-wages` edge function | real wages |
| `fetchLiveLaborForToday` from the overlay | `kiosk-wages` | real wages |
| Phone Dash Summary (not reachable from a kiosk session) | `get_current_wages_batch` | would be masked to $15 |

## 5. Can two manager phones still disagree on Labor % for the same sales?

Two accounts that are both **manager or higher**: no — both get real wages, identical Labor %.

But a shift manager's phone and a manager's phone **will** disagree on today's Labor % for the
same sales, because the shift manager's session gets $15 per hour for everyone. It is not
impossible on the phone Summary; it is only impossible above the manager line.

## Options if Jordan wants it fixed (no code written yet)

1. Route the phone Summary's live-labor call through the same authorized helper the kiosk uses, so today's dollars are real for every role allowed to see sales.
2. Or hide today's Labor % (show hours only) for roles that cannot read real wages, instead of showing a number computed from a placeholder.
3. Or widen the wage RPC's privilege test to `shift_manager` — least preferable, since it exposes pay rates further down the org.

Option 1 keeps pay rates off the client and makes both surfaces agree by construction.
No files were changed for this audit.

# Shift-manager wage privacy vs labor totals — findings only, no code

## Conclusion first

- **Yes — today a shift manager sees wrong labor dollars on the phone Summary.** Today's live labor is computed on the phone via `get_current_wages_batch`, which masks every wage to $15 for anyone below `manager`. Shift managers see a wrong (usually inflated) Labor % for the current day. Completed days are correct (server-computed `labor_cache`).
- **No — shift managers cannot see individual wages anywhere.** They can open team profile cards, but those cards show only name, nickname, photo, phone, birthday. The wage data is unreachable to them at the database level, not just hidden in the UI.

## A) Can a shift manager open another user's profile / user-management card?

- `/users` (UserManagement page): **no.** `src/hooks/useUserManagementData.tsx` line 78: `canAccessPage = isAdmin || isManager`, and line 126-130 redirects away otherwise. In `src/hooks/useUserRole.tsx`, `isManager` starts at the `manager` role — shift managers are excluded.
- `/my-team` (MyTeam page): **yes, intentionally.** `canViewAllProfiles = isShiftManager` (shift manager and above, `useUserRole.tsx` line ~89). `src/pages/MyTeam.tsx` has no role gate; it lists active teammates at the location with name, nickname, photo, phone, birthday only (line 67 selects exactly those columns).
- Routes in `src/App.tsx` (lines 215-216) are plain `ProtectedRoute` (signed-in only); the role gate lives inside each page.

## B) If they can open it, is `hourly_wage` / wage history shown?

Never. Two independent layers:

1. **UI:** `MyTeam.tsx` selects only `id, full_name, nickname, profile_photo_url, phone_number, birthday`. Wage dialogs exist only in `src/components/users/UserManagementDialogs.tsx` (Wage dialog + history dialog), which is unreachable to shift managers via the `/users` gate above.
2. **Database:** `profiles.hourly_wage` is column-revoked (see `src/lib/profileColumns.ts` — it is explicitly excluded from selectable columns). `wage_history` RLS (verified live): all four policies require `is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin')` — select, insert, update, delete. A shift manager's direct query returns zero rows.

## C) Where does today's labor $ come from for a shift-manager session?

| Surface | Today's labor source | Wage resolution for shift_manager | Result |
|---|---|---|---|
| Phone Dash Summary (`src/components/dashboard/SalesSummary.tsx` lines 237, 720) | `fetchLiveLaborForToday()` with default wage source | `get_current_wages_batch` (`src/utils/liveLabor.ts` line 80) | **$15 mask → wrong Labor % today** |
| Phone Summary, completed days (lines 190-207, 395-410) | `labor_cache` (prefers `source='punch_clock'`) | server-computed real wages | correct |
| Dynamic Manager overlay (`src/components/punchclock/ManagerDashboardOverlay.tsx` lines ~426, ~479) | `kiosk-wages` edge function for both employee list and `fetchLiveLaborForToday({ wageSource: 'kiosk' })` | real wages, authorized by paired device or manager+ | correct — but a shift-manager **phone** session hitting `kiosk-wages` gets 403 (manager-only human path), so this helper can't be reused as-is for phone |

`has_role_or_higher(auth.uid(), 'manager')` (verified live) excludes `shift_manager` and `shift_manager_in_training`; `useTeamSalesVisibility.tsx` shows them the Summary anyway. That gap is the bug Jordan is pointing at.

## D) Privacy-safe design: aggregate labor without per-person wages

Nothing like this exists today for phone sessions. The current options are: `get_current_wages_batch` (per-user wages, manager+ only, $15 mask otherwise) and `kiosk-wages` (per-user wages, paired-device or manager+ only). Both ship individual rates to the client.

Proposed: a new server-side **`live-labor-totals` endpoint** that:

- Authorizes: shift manager or higher with membership at that location (reuse `has_role_or_higher` + `user_locations` check, same pattern as `kiosk-wages`).
- Computes hours × wage server-side (same punch bucketing as `_shared/punchLabor.ts` / `fetchLiveLaborForToday`) and returns **only** `{ date, hours, cost }` for the location — no per-user wages, no per-user costs, nothing about individuals.
- Phone Summary (and the Dynamic Manager overlay when opened by a phone manager) calls this instead of the wage RPC. `labor_cache` stays untouched for closed days; locked cache rules unaffected.

This gives shift managers real Labor % and Labor $ for labor decisions while keeping every pay rate off their device. It also guarantees all phones agree with each other and with the punch clock.

## No files were changed for this audit.

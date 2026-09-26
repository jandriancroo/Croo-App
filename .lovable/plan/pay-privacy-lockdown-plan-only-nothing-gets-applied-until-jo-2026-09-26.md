# Pay-privacy lockdown: plan only (nothing gets applied until Jordan says go)

## In plain English
This hides pay rates, punch PINs, each person's labor breakdown and Ovation logins from everyone's browser. It also stops employees from changing their own wage, role or active status. Managers still see labor totals, cut savings stay the same, and nothing changes on the punch clock.

**This change hits the LIVE database.** The preview and croohq.com use the same database, and there's no separate test copy. So:
- Apply it after close, and only when Jordan says go.
- Keep the rollback SQL open while it runs.
- The IntegrationsSection.tsx change has to ship with the migration or before it.

## (a) Column lists checked against the live database
| Table | Columns in the live database | Left out of the GRANT |
|---|---|---|
| profiles (29 columns) | all 26 granted columns exist | hourly_wage, employee_pin, pin_pending_plaintext. No other column was missed. |
| labor_cache (16 columns) | all 15 granted columns exist | employee_breakdown |
| ovation_integrations (10 columns) | all 7 granted columns exist | auth_token, cognito_username, cognito_password |
| ovation_location_mappings (9 columns) | all 6 granted columns exist | auth_token, cognito_username, cognito_password |

Other checks:
- **profiles.role and profiles.is_active:** both exist.
- **ovation_integrations policies:** the exact names are "Brand admins can view ovation integrations" (SELECT) and "Brand admins can manage ovation integrations" (ALL).
- **ovation_location_mappings:** has one policy, "Admins can manage ovation location mappings". Your SQL doesn't change it.
- **labor_cache policies:** "Punch device can read labor_cache at its location", "Users can view labor cache for their locations" and "Service role can manage labor cache". None of them change.
- **Helper functions:** has_role, is_super_admin, has_role_or_higher and has_location_access all exist. has_role(uid,'admin') returns true for admin, org_admin and super_admin. It does not return true for brand_admin, general_manager or manager.
- **Guard trigger:** guard_hourly_wage_update and trg_guard_hourly_wage don't exist today, so they are new. DROP TRIGGER IF EXISTS is safe, and rollback (d) removes them completely.
- **Today's function grants:** get_labor_totals_for_dates and mark_labor_cache_stale can currently be run by PUBLIC, anon and authenticated. That confirms (c) is needed.
- **Migration runner:** it already wraps each migration in a transaction. So I'll drop only the explicit BEGIN/COMMIT and change nothing else.

## (b) Files I would touch
1. `supabase/migrations/<timestamp>_pay_privacy_lockdown.sql`: your SQL exactly as written, minus BEGIN/COMMIT, with section (d) swapped for the Guard trigger v2 SQL word for word:
   - It branches on TG_OP.
   - Trusted context means `auth.uid() IS NULL AND coalesce(auth.role(),'') NOT IN ('anon','authenticated')`. auth.role() exists in the live database.
   - An admin (has_role(uid,'admin') or is_super_admin) passes.
   - A non-admin INSERT has role 'staff', is_active true and hourly_wage 15.00 forced. These match the live column defaults.
   - A non-admin UPDATE that changes a guarded column raises 42501.
   - The trigger is `BEFORE INSERT OR UPDATE OF hourly_wage, role, is_active`, and the function and trigger names are unchanged.
2. `src/components/settings/IntegrationsSection.tsx`:
   - Use the two explicit column lists at ~:283 and ~:293.
   - Stop pre-filling email/password at ~:337-355 and use the placeholder "Saved. Re-enter to change".
   - Keep company_id without reading any login column (see below).
3. `supabase/functions/schedule-service/index.ts` (handleOptimizeLabor ~:522 and handleAutoSchedule): before any wage is read:
   - Check the caller with auth.getUser.
   - Require has_role_or_higher(uid,'manager') AND has_location_access(uid, location_id).
   - Keep only user_ids that belong to that location (via user_locations).
   - Return 401 if there's no valid user, 403 if the caller isn't a manager or has no access to the location.
4. `supabase/functions/ai-assistant/index.ts`:
   - Pass the caller's role into executeTool (~:704).
   - Only when a tool gets `args.location_id`: run has_location_access(userId, args.location_id), and refuse that tool if it fails. Tools called without a location, including org-wide and super_admin/org_admin queries, skip this check and are never refused because of it.
   - Below manager: drop employee_breakdown from query_labor (~:825), and skip the wage-map math that reads employee_breakdown (~:1901, ~:2017).
5. `supabase/functions/kiosk-wages/`: delete the folder and undeploy the function. Nothing in src, scripts, .github or other functions calls it. The only other reference is config.toml.
6. `supabase/config.toml`: remove only the `[functions.kiosk-wages]` block (lines 121-122).

**Keeping company_id (mapping first, then brand fallback):**
`setOvationCompanyId(ovationMapping?.company_id || ovationIntegration?.company_id || '')`, alongside `setOvationLocationId(ovationMapping?.ovation_location_id || '')`. Both company_id columns stay readable. This removes the check on `cognito_username` completely.

Small difference from today: if a location mapping has a company_id but no saved login, today's code uses the brand's company_id. The new code uses the mapping's company_id. I think that's the more correct choice.

**Save path and active toggle:** these keep working as they are.
- The save (~:1619-1660) does plain `update`/`insert` with no `.select()`.
- Its pre-check reads `select('id')`, which is still allowed.
- The toggle (~:1510) is a plain update of `is_active`.

## (c) Kiosk files: none touched
PunchClock.tsx, ManagerDashboardOverlay, CompactDashboard, punch-device-service, AlarmTaskOverlay, punchDevicePairing.ts, liveLabor.ts and useCutSavingsTotal.ts are not edited. get_cut_savings_total and both punch-device row policies stay as they are. I'm not adding a kiosk PIN gate.

## (d) What could break, and what I checked
Clean:
- **Whole-row reads:** there are no `select('*')` or `profiles(*)` reads of profiles or labor_cache anywhere in the app. The only two whole-row reads are the Ovation ones in IntegrationsSection, which this change fixes.
- **Wage reads:** pay rates in the app already come from wage_history or wage RPCs, not from profiles.
- **PIN reads:**
  - pin_pending_plaintext is read only through the get_punch_pin_for_user and get_pin_migration_health RPCs (MyPunchPinCard, EmployeeNewPinField, PinMigrationHealthPanel).
  - employee_pin is read through admin_get_employee_pin.
  - None of these read the columns directly, so they keep working.
- **labor breakdown:** no browser code reads employee_breakdown. Only the backend jobs do (labor-service, maintenance-service, labor-intelligence, ai-assistant), and they run with full service access.
- **Save-and-read-back calls:** there are no `.insert().select()` or `.update().select()` calls on any of the four tables.
- **Role changes:** role changes in the app go to user_roles (OrganizationMembersSection). Nothing in the app updates profiles.role or profiles.is_active.

**Code that creates or upserts profiles:**
- **Browser code:** nothing inserts or upserts profiles.
- **user-service (index.ts:195):** the only upsert. It passes `hourly_wage`, but it runs with full service access. That counts as a trusted server context (uid is NULL and the role is service_role), so its values are kept, and a conflicting upsert passes the UPDATE branch.
- **handle_new_user (signup trigger):** inserts only id, email, full_name and profile_photo_url. It runs with no sign-in details attached, so it's trusted. The live column defaults it relies on are role 'staff', is_active true and hourly_wage 15.00, which match the forced values.
- **Result:** no code path loses a value it meant to set.

**Risks to flag:**
1. **The wage gate stays admin-only, as decided.** It allows admin, org_admin and super_admin plus trusted server context, and is not widened to general_manager.
   - Where: useUserManagementData.tsx:359 and :616.
   - What happens: a general manager's wage edit already fails at the wage_history rule, which requires admin, before it ever reaches profiles. So this adds nothing new that breaks.
2. **Profile saves could hit the new guard.** EmployeeProfileDialog.tsx:415 saves `employee_pin` on the profile. It doesn't touch the guarded columns, so the trigger passes. But any update that re-sends an unchanged role or is_active still passes too, because of the IS NOT DISTINCT FROM check.
3. **Ovation needs the login re-typed to save.** The save first tests the login with the typed email/password. With those fields blank, a store can't change just its Ovation Location ID without re-typing the login. The toggle still works. Blocking an empty save is optional and out of scope.
4. **Types file:** the generated types still list the hidden columns. That's harmless, but `as any` reads of those columns will quietly come back empty.

## Rollback
Keep your per-section rollback SQL open while the migration runs.
- **(d):** unchanged. The function and trigger names stay the same, and neither exists today, so dropping them undoes (d) completely.
- **(f):** replaced with Ryan's exact-ACL version, word for word. It revokes and then re-grants table-level SELECT to authenticated on both Ovation tables, gives anon nothing on ovation_integrations, and gives anon SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on ovation_location_mappings only. The earlier "GRANT ALL on ovation_integrations to anon" line is gone.

## Order on go-night
1. Publish the IntegrationsSection.tsx change, plus the two backend function changes and the kiosk-wages removal.
2. Run the migration after close, with the rollback SQL open.
3. Quick checks:
   - A regular employee's profile screen loads.
   - The schedule labor totals load for a manager.
   - The Ovation settings screen loads with blank email/password and the company ID filled in.
   - An employee trying to change their own wage gets a permission error (42501).
   - **W11:** Sign in as a non-admin user who has no profile row. Insert your own profile with role='super_admin', is_active=false and hourly_wage=99. Expected: no error, and the saved row has role='staff', is_active=true and hourly_wage=15.00.
   - A brand-new signup still gets a profile row. This covers the handle_new_user path.

-- (a) profiles: undo the Aug 3 re-grant. REVOKE on the table also drops the
-- column grants, so re-grant the 26 safe columns immediately (same list as
-- Jul 31 and src/lib/profileColumns.ts). hourly_wage, employee_pin,
-- pin_pending_plaintext become unreadable to anon/authenticated.
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (
  id, email, full_name, role, created_at, updated_at, profile_photo_url, is_active,
  phone_number, birthday, display_order, croo_cash_balance, appears_on_schedule,
  default_location_id, min_weekly_hours, max_weekly_hours, first_login_at, invited_by,
  all_locations_enabled, app_version, weekly_availability, last_login_at, nickname,
  pin_pending, pin_pending_set_at, pin_pending_set_by
) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- (b) labor_cache: hide the per-person JSON (user_id, hours, wage, cost) from
-- every client role. Aggregates stay readable under the existing row policies;
-- policies (incl. "Punch device can read labor_cache at its location") untouched.
REVOKE SELECT ON public.labor_cache FROM anon, authenticated;
GRANT SELECT (
  id, location_id, labor_date, source, labor_cost, labor_hours, regular_hours,
  overtime_hours, double_time_hours, hourly_breakdown, fetched_at, created_at,
  updated_at, is_stale, last_validated_at
) ON public.labor_cache TO authenticated;
GRANT ALL ON public.labor_cache TO service_role;

-- (c) function grants. PUBLIC must go too, or anon keeps EXECUTE through PUBLIC.
REVOKE ALL ON FUNCTION public.get_labor_totals_for_dates(uuid, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_labor_totals_for_dates(uuid, date[]) TO authenticated, service_role;

-- Trigger function: EXECUTE is not checked when a trigger fires.
REVOKE ALL ON FUNCTION public.mark_labor_cache_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_labor_cache_stale() TO service_role;

-- (d) Guard trigger v2 (Claude REQUIRED 1 + OPTIONAL hardening). Names unchanged so rollback (d) is unchanged.
-- Only admins (admin / org_admin / super_admin via has_role, or is_super_admin) or a trusted
-- server context may SET profiles.hourly_wage, role or is_active.
-- Trusted context = auth.uid() IS NULL AND auth.role() is not anon/authenticated:
--   service_role (user-service, edge functions), migrations, SQL editor, GoTrue's
--   on_auth_user_created -> handle_new_user (no JWT claims, so uid and role are NULL).
-- INSERT by anyone else: FORCE the live column defaults (role 'staff', is_active true,
-- hourly_wage 15.00) instead of raising, so self-signup / "Users can create own profile" still works.
-- UPDATE by anyone else that changes a guarded column: 42501.
CREATE OR REPLACE FUNCTION public.guard_hourly_wage_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.hourly_wage IS NOT DISTINCT FROM OLD.hourly_wage
     AND NEW.role        IS NOT DISTINCT FROM OLD.role
     AND NEW.is_active   IS NOT DISTINCT FROM OLD.is_active THEN
    RETURN NEW;                                   -- no actual change to guarded columns
  END IF;

  IF v_uid IS NULL AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;                                   -- service role / migrations / SQL editor / signup trigger
  END IF;

  IF v_uid IS NOT NULL
     AND (public.has_role(v_uid, 'admin'::app_role)   -- admin, org_admin, super_admin
          OR public.is_super_admin(v_uid)) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Non-admin insert (self-signup path): force the live column defaults.
    NEW.role        := 'staff';
    NEW.is_active   := true;
    NEW.hourly_wage := 15.00;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'permission denied: only admins can change hourly_wage, role or is_active'
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_hourly_wage_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_hourly_wage_update() TO service_role;

DROP TRIGGER IF EXISTS trg_guard_hourly_wage ON public.profiles;
CREATE TRIGGER trg_guard_hourly_wage
  BEFORE INSERT OR UPDATE OF hourly_wage, role, is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_hourly_wage_update();

-- (e) Ovation: authorize super admins via user_roles (is_super_admin), not the
-- self-editable profiles.role text column. Names kept so rollback is exact.
ALTER POLICY "Brand admins can view ovation integrations" ON public.ovation_integrations
  USING (
    EXISTS (SELECT 1 FROM public.brand_members bm
            WHERE bm.brand_id = ovation_integrations.brand_id
              AND bm.user_id = auth.uid()
              AND bm.brand_role = ANY (ARRAY['admin'::text, 'owner'::text]))
    OR public.is_super_admin(auth.uid())
  );
ALTER POLICY "Brand admins can manage ovation integrations" ON public.ovation_integrations
  USING (
    EXISTS (SELECT 1 FROM public.brand_members bm
            WHERE bm.brand_id = ovation_integrations.brand_id
              AND bm.user_id = auth.uid()
              AND bm.brand_role = ANY (ARRAY['admin'::text, 'owner'::text]))
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.brand_members bm
            WHERE bm.brand_id = ovation_integrations.brand_id
              AND bm.user_id = auth.uid()
              AND bm.brand_role = ANY (ARRAY['admin'::text, 'owner'::text]))
    OR public.is_super_admin(auth.uid())
  );

-- (f) Ovation creds become write-only for client roles; service_role keeps everything.
-- REVOKE on the table drops column grants, so re-grant the safe columns in the same txn.
REVOKE ALL ON public.ovation_integrations      FROM anon;
REVOKE ALL ON public.ovation_location_mappings FROM anon;
REVOKE SELECT ON public.ovation_integrations      FROM authenticated;
REVOKE SELECT ON public.ovation_location_mappings FROM authenticated;
GRANT SELECT (id, brand_id, company_id, is_active, token_updated_at, created_at, updated_at)
  ON public.ovation_integrations TO authenticated;
GRANT SELECT (id, location_id, ovation_location_id, company_id, token_updated_at, created_at)
  ON public.ovation_location_mappings TO authenticated;
GRANT ALL ON public.ovation_integrations      TO service_role;
GRANT ALL ON public.ovation_location_mappings TO service_role;
-- INSERT/UPDATE for authenticated stay as they are (settings save path writes creds).
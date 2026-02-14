
-- ============================================================
-- 1. JOB_APPLICATIONS: Drop public SELECT, keep org admin access
-- ============================================================
DROP POLICY IF EXISTS "Applicants can view own applications by email" ON public.job_applications;

-- Applicants on the public portal look up by email (no auth), but restrict to their own
-- We need anon access for the public application portal, but scoped
CREATE POLICY "Applicants can view own applications by email"
  ON public.job_applications
  FOR SELECT
  USING (
    -- Authenticated staff with location/org access
    (auth.uid() IS NOT NULL AND (
      can_manage_org_applications(auth.uid(), organization_id) 
      OR has_location_access(auth.uid(), location_id)
    ))
    -- Public portal: handled by edge functions with service role, not direct access
  );

-- ============================================================
-- 2. HIRING_MESSAGES: Drop public SELECT
-- ============================================================
DROP POLICY IF EXISTS "Public can view messages" ON public.hiring_messages;

-- Applicants access messages via access_token through edge functions (service role)
-- Only staff with conversation access can read directly
-- (Staff policy already exists, so no new policy needed)

-- ============================================================
-- 3. SCHEDULED_SHIFTS: Replace public SELECT with location-based
-- ============================================================
DROP POLICY IF EXISTS "Users can view all scheduled shifts" ON public.scheduled_shifts;

CREATE POLICY "Users can view shifts at their locations"
  ON public.scheduled_shifts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scheduled_shifts ss
      JOIN schedules s ON s.id = ss.schedule_id
      WHERE ss.id = scheduled_shifts.id
        AND has_location_access(auth.uid(), s.location_id)
    )
  );

-- ============================================================
-- 4. SALES_CACHE: Restrict service role policy to service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage sales cache" ON public.sales_cache;

CREATE POLICY "Service role can manage sales cache"
  ON public.sales_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Drop the redundant general SELECT (the shift_manager one is sufficient)
DROP POLICY IF EXISTS "Users can view sales data for their location" ON public.sales_cache;

-- ============================================================
-- 5. LABOR_CACHE: Restrict service role policy to service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage labor cache" ON public.labor_cache;

CREATE POLICY "Service role can manage labor cache"
  ON public.labor_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Drop the redundant general SELECT (the location_access one is sufficient)
DROP POLICY IF EXISTS "Users can view labor data for their location" ON public.labor_cache;

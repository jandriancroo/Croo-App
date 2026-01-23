-- Drop existing policies
DROP POLICY IF EXISTS "Users can view applicant flags for their organization" ON public.applicant_flags;
DROP POLICY IF EXISTS "Users can create applicant flags for their organization" ON public.applicant_flags;

-- Recreate SELECT policy with better handling for null location_id
CREATE POLICY "Users can view applicant flags for their organization"
ON public.applicant_flags FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM job_applications ja
    JOIN profiles p ON p.id = auth.uid()
    WHERE ja.id = applicant_flags.application_id
    AND (
      -- Super admin can see all
      is_super_admin(auth.uid())
      -- Org admin can see all in their org
      OR is_org_admin(auth.uid(), ja.organization_id)
      -- Manager with org access
      OR can_manage_org_applications(auth.uid(), ja.organization_id)
      -- If application has a location, check location access
      OR (ja.location_id IS NOT NULL AND has_location_access(auth.uid(), ja.location_id))
    )
  )
);

-- Recreate INSERT policy with better handling for null location_id
CREATE POLICY "Users can create applicant flags for their organization"
ON public.applicant_flags FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM job_applications ja
    JOIN profiles p ON p.id = auth.uid()
    WHERE ja.id = applicant_flags.application_id
    AND (
      -- Super admin can flag all
      is_super_admin(auth.uid())
      -- Org admin can flag all in their org
      OR is_org_admin(auth.uid(), ja.organization_id)
      -- Manager with org access
      OR can_manage_org_applications(auth.uid(), ja.organization_id)
      -- If application has a location, check location access
      OR (ja.location_id IS NOT NULL AND has_location_access(auth.uid(), ja.location_id))
    )
  )
);
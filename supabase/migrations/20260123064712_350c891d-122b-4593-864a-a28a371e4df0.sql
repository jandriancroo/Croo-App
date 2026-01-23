-- Drop the existing INSERT policy that's too restrictive
DROP POLICY IF EXISTS "Users can create applicant notes for their org" ON public.applicant_notes;

-- Create a simpler INSERT policy that checks location access
CREATE POLICY "Users can create applicant notes"
  ON public.applicant_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.job_applications ja
      LEFT JOIN public.locations l ON l.id = ja.location_id
      WHERE ja.id = application_id
        AND (
          -- Super admin can always create
          public.is_super_admin(auth.uid())
          -- User has access to the location
          OR public.has_location_access(auth.uid(), ja.location_id)
          -- Or org admin for the location's org
          OR (l.organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), l.organization_id))
        )
    )
  );

-- Also fix the SELECT policy
DROP POLICY IF EXISTS "Users can view applicant notes for their org" ON public.applicant_notes;

CREATE POLICY "Users can view applicant notes"
  ON public.applicant_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.job_applications ja
      LEFT JOIN public.locations l ON l.id = ja.location_id
      WHERE ja.id = applicant_notes.application_id
        AND (
          public.is_super_admin(auth.uid())
          OR public.has_location_access(auth.uid(), ja.location_id)
          OR (l.organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), l.organization_id))
        )
    )
  );
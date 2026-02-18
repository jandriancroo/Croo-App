-- Allow public access to locations for the public job application page
CREATE POLICY "Public can view locations for applications"
ON public.locations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = locations.organization_id
      AND o.is_active = true
  )
);
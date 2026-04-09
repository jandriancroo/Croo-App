DROP POLICY IF EXISTS "Admins can manage ovation location mappings" ON public.ovation_location_mappings;

CREATE POLICY "Admins can manage ovation location mappings"
ON public.ovation_location_mappings
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role = ANY (ARRAY['super_admin','admin','org_admin'])
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role = ANY (ARRAY['super_admin','admin','org_admin'])
  )
);
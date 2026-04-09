DROP POLICY IF EXISTS "Admins can manage ovation location mappings" ON public.ovation_location_mappings;

CREATE POLICY "Admins can manage ovation location mappings"
ON public.ovation_location_mappings
FOR ALL
TO authenticated
USING (
  public.has_role_or_higher(auth.uid(), 'admin')
)
WITH CHECK (
  public.has_role_or_higher(auth.uid(), 'admin')
);
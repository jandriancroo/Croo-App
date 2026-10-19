CREATE POLICY "Assigned staff can view their location brands"
ON public.brands
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    JOIN public.locations l ON l.id = ul.location_id
    LEFT JOIN public.organizations o ON o.id = l.organization_id
    WHERE ul.user_id = auth.uid()
      AND (l.brand_id = brands.id OR o.brand_id = brands.id)
  )
);

CREATE POLICY "Assigned staff can view their location organizations"
ON public.organizations
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    JOIN public.locations l ON l.id = ul.location_id
    WHERE ul.user_id = auth.uid()
      AND l.organization_id = organizations.id
  )
);
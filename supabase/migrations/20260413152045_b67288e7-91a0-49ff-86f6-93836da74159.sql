
-- Drop restrictive org-member-only policies
DROP POLICY IF EXISTS "Users can view menu prices at their locations" ON public.menu_price_overrides;
DROP POLICY IF EXISTS "Users can create menu prices at their locations" ON public.menu_price_overrides;
DROP POLICY IF EXISTS "Users can update menu prices at their locations" ON public.menu_price_overrides;
DROP POLICY IF EXISTS "Users can delete menu prices at their locations" ON public.menu_price_overrides;

-- Recreate with location-based access (matches inventory system pattern)
CREATE POLICY "Users can view menu prices at their locations"
ON public.menu_price_overrides FOR SELECT
TO authenticated
USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can create menu prices at their locations"
ON public.menu_price_overrides FOR INSERT
TO authenticated
WITH CHECK (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update menu prices at their locations"
ON public.menu_price_overrides FOR UPDATE
TO authenticated
USING (public.has_location_access(auth.uid(), location_id))
WITH CHECK (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can delete menu prices at their locations"
ON public.menu_price_overrides FOR DELETE
TO authenticated
USING (public.has_location_access(auth.uid(), location_id));

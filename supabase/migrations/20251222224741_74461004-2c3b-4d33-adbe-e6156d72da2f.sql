-- Fix sales_cache visibility: use centralized location access function

DROP POLICY IF EXISTS "Users can view sales cache for their locations" ON public.sales_cache;

CREATE POLICY "Users can view sales cache for their locations"
ON public.sales_cache
FOR SELECT
USING (public.has_location_access(auth.uid(), location_id));

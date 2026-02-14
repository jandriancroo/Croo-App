-- Allow managers to upsert override projections into sales_cache
CREATE POLICY "Managers can upsert sales cache for their locations"
ON public.sales_cache
FOR INSERT
WITH CHECK (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'shift_manager'::text)
);

CREATE POLICY "Managers can update sales cache for their locations"
ON public.sales_cache
FOR UPDATE
USING (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'shift_manager'::text)
);
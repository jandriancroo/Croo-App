-- Enable RLS on sales_cache and labor_cache
ALTER TABLE public.sales_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_cache ENABLE ROW LEVEL SECURITY;

-- RLS policy for sales_cache: authenticated users at the location can view sales data
CREATE POLICY "Users can view sales data for their location"
  ON public.sales_cache
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_locations
      WHERE user_locations.user_id = auth.uid()
      AND user_locations.location_id = sales_cache.location_id
    )
  );

-- RLS policy for labor_cache: authenticated users at the location can view labor data
CREATE POLICY "Users can view labor data for their location"
  ON public.labor_cache
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_locations
      WHERE user_locations.user_id = auth.uid()
      AND user_locations.location_id = labor_cache.location_id
    )
  );
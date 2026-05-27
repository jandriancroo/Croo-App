-- Twin of sales_cache for Clover-sourced (Playa Bowls) data.
CREATE TABLE public.clover_sales_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL,
  sale_date DATE NOT NULL,
  net_sales NUMERIC NOT NULL DEFAULT 0,
  guest_count INTEGER NOT NULL DEFAULT 0,
  avg_ticket NUMERIC NOT NULL DEFAULT 0,
  hourly_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  projected_sales NUMERIC,
  validation_status TEXT,
  validation_attempts INTEGER NOT NULL DEFAULT 0,
  flagged_no_sales BOOLEAN NOT NULL DEFAULT false,
  yoy_sale_date DATE,
  yoy_net_sales NUMERIC,
  yoy_hourly_data JSONB,
  payments_data JSONB,
  living_projection NUMERIC,
  override_projection NUMERIC,
  override_at TIMESTAMPTZ,
  override_by UUID,
  initial_projection NUMERIC,
  product_mix JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clover_sales_cache_location_date_uniq UNIQUE (location_id, sale_date)
);

CREATE INDEX clover_sales_cache_location_date_idx
  ON public.clover_sales_cache (location_id, sale_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clover_sales_cache TO authenticated;
GRANT ALL ON public.clover_sales_cache TO service_role;

ALTER TABLE public.clover_sales_cache ENABLE ROW LEVEL SECURITY;

-- Mirror sales_cache policy shape: scope by location membership.
CREATE POLICY "Users can view clover sales for their locations"
ON public.clover_sales_cache
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = clover_sales_cache.location_id
  )
);

CREATE POLICY "Users can insert clover sales for their locations"
ON public.clover_sales_cache
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = clover_sales_cache.location_id
  )
);

CREATE POLICY "Users can update clover sales for their locations"
ON public.clover_sales_cache
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = clover_sales_cache.location_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = clover_sales_cache.location_id
  )
);

CREATE POLICY "Users can delete clover sales for their locations"
ON public.clover_sales_cache
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = clover_sales_cache.location_id
  )
);
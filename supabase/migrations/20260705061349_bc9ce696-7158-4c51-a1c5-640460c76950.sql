ALTER TABLE public.sales_cache
  ADD COLUMN IF NOT EXISTS pace_adjusted_projection NUMERIC,
  ADD COLUMN IF NOT EXISTS pace_calculated_at TIMESTAMPTZ;